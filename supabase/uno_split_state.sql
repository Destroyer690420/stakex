-- ========================================
-- UNO SPLIT STATE ARCHITECTURE
-- Separates heavy data (deck/hands) from public state (turn/top card)
-- to minimize Realtime bandwidth and fix sync issues
-- ========================================

-- ========================================
-- STEP 1: DROP OLD FUNCTIONS (Clean Slate)
-- ========================================
DROP FUNCTION IF EXISTS fn_create_uno_room(UUID, NUMERIC, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS fn_join_uno_room(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_start_uno_game(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_leave_uno_room(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_play_card(UUID, UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_draw_card(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_toggle_ready(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_call_uno(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_get_uno_rooms() CASCADE;
DROP FUNCTION IF EXISTS fn_delete_uno_room(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_cleanup_stale_uno_rooms(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS fn_get_my_hand(UUID, UUID) CASCADE;

-- ========================================
-- STEP 2: REMOVE OLD TABLES FROM REALTIME
-- ========================================
DO $$
BEGIN
    -- Try to remove uno_rooms from realtime (ignore if not present)
    BEGIN
        ALTER PUBLICATION supabase_realtime DROP TABLE uno_rooms;
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Ignore if table not in publication
    END;
    
    -- Try to remove uno_players from realtime (ignore if not present)
    BEGIN
        ALTER PUBLICATION supabase_realtime DROP TABLE uno_players;
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Ignore if table not in publication
    END;
END $$;

-- ========================================
-- STEP 3: CREATE NEW SPLIT STATE TABLES
-- ========================================

-- Public State Table (~500 bytes max) - REALTIME ENABLED
CREATE TABLE IF NOT EXISTS uno_public_states (
    room_id UUID PRIMARY KEY REFERENCES uno_rooms(id) ON DELETE CASCADE,
    current_turn_index INTEGER DEFAULT 0,
    direction INTEGER DEFAULT 1 CHECK (direction IN (1, -1)),
    top_card JSONB,
    current_color TEXT CHECK (current_color IN ('red', 'blue', 'green', 'yellow', NULL)),
    player_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
    last_event TEXT,  -- 'card_played', 'card_drawn', 'player_joined', 'player_left', 'game_started'
    last_event_user_id UUID,
    winner_id UUID REFERENCES public.users(id),
    winner_username TEXT,
    turn_started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hidden State Table (Heavy data ~10KB+) - NO REALTIME
CREATE TABLE IF NOT EXISTS uno_hidden_states (
    room_id UUID PRIMARY KEY REFERENCES uno_rooms(id) ON DELETE CASCADE,
    deck JSONB DEFAULT '[]'::jsonb,
    player_hands JSONB DEFAULT '{}'::jsonb  -- { "user_id": [cards], ... }
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_uno_public_states_status ON uno_public_states(status);
CREATE INDEX IF NOT EXISTS idx_uno_public_states_room ON uno_public_states(room_id);

-- ========================================
-- STEP 4: MODIFY uno_rooms TABLE
-- Remove game state columns (now in split tables)
-- ========================================

-- Drop columns that are now in split tables (if they exist)
DO $$
BEGIN
    -- Remove deck if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'deck') THEN
        ALTER TABLE uno_rooms DROP COLUMN deck;
    END IF;
    
    -- Remove top_card if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'top_card') THEN
        ALTER TABLE uno_rooms DROP COLUMN top_card;
    END IF;
    
    -- Remove current_color if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'current_color') THEN
        ALTER TABLE uno_rooms DROP COLUMN current_color;
    END IF;
    
    -- Remove current_turn_index if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'current_turn_index') THEN
        ALTER TABLE uno_rooms DROP COLUMN current_turn_index;
    END IF;
    
    -- Remove direction if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'direction') THEN
        ALTER TABLE uno_rooms DROP COLUMN direction;
    END IF;
    
    -- Remove turn_started_at if exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'turn_started_at') THEN
        ALTER TABLE uno_rooms DROP COLUMN turn_started_at;
    END IF;
    
    -- Remove winner_id if exists (now in public_states)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'winner_id') THEN
        ALTER TABLE uno_rooms DROP COLUMN winner_id;
    END IF;
    
    -- Remove winner_username if exists (now in public_states)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_rooms' AND column_name = 'winner_username') THEN
        ALTER TABLE uno_rooms DROP COLUMN winner_username;
    END IF;
END $$;

-- Drop hand column from uno_players (now in hidden_states.player_hands)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_players' AND column_name = 'hand') THEN
        ALTER TABLE uno_players DROP COLUMN hand;
    END IF;
    
    -- Add hand_count column if not exists (tracks card count for opponent display)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_players' AND column_name = 'hand_count') THEN
        ALTER TABLE uno_players ADD COLUMN hand_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- ========================================
-- HELPER FUNCTIONS (Keep existing)
-- ========================================

CREATE OR REPLACE FUNCTION generate_uno_deck()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_deck JSONB := '[]'::jsonb;
    v_colors TEXT[] := ARRAY['red', 'blue', 'green', 'yellow'];
    v_color TEXT;
    v_card_id INTEGER := 1;
BEGIN
    FOREACH v_color IN ARRAY v_colors LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object(
            'id', v_card_id, 'color', v_color, 'value', '0', 'type', 'number'
        ));
        v_card_id := v_card_id + 1;
        
        FOR i IN 1..9 LOOP
            FOR j IN 1..2 LOOP
                v_deck := v_deck || jsonb_build_array(jsonb_build_object(
                    'id', v_card_id, 'color', v_color, 'value', i::TEXT, 'type', 'number'
                ));
                v_card_id := v_card_id + 1;
            END LOOP;
        END LOOP;
        
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object(
                'id', v_card_id, 'color', v_color, 'value', 'skip', 'type', 'action'
            ));
            v_card_id := v_card_id + 1;
        END LOOP;
        
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object(
                'id', v_card_id, 'color', v_color, 'value', 'reverse', 'type', 'action'
            ));
            v_card_id := v_card_id + 1;
        END LOOP;
        
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object(
                'id', v_card_id, 'color', v_color, 'value', '+2', 'type', 'action'
            ));
            v_card_id := v_card_id + 1;
        END LOOP;
    END LOOP;
    
    FOR j IN 1..4 LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object(
            'id', v_card_id, 'color', NULL, 'value', 'wild', 'type', 'wild'
        ));
        v_card_id := v_card_id + 1;
    END LOOP;
    
    FOR j IN 1..4 LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object(
            'id', v_card_id, 'color', NULL, 'value', '+4', 'type', 'wild'
        ));
        v_card_id := v_card_id + 1;
    END LOOP;
    
    RETURN v_deck;
END;
$$;

CREATE OR REPLACE FUNCTION shuffle_jsonb_array(p_arr JSONB)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(elem ORDER BY random())
    INTO v_result
    FROM jsonb_array_elements(p_arr) AS elem;
    
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ========================================
-- NEW RPC: Get My Hand (Lightweight fetch)
-- ========================================
CREATE OR REPLACE FUNCTION fn_get_my_hand(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_hand JSONB;
BEGIN
    SELECT player_hands->p_user_id::TEXT
    INTO v_hand
    FROM uno_hidden_states
    WHERE room_id = p_room_id;
    
    RETURN COALESCE(v_hand, '[]'::jsonb);
END;
$$;

-- ========================================
-- RPC: Create UNO Room (Updated for split state)
-- ========================================
CREATE OR REPLACE FUNCTION fn_create_uno_room(
    p_user_id UUID,
    p_bet_amount NUMERIC,
    p_max_players INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_username TEXT;
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_room_id UUID;
    v_max_p INTEGER;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    IF p_bet_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is $10');
    END IF;
    
    IF p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is $10,000');
    END IF;
    
    v_max_p := COALESCE(p_max_players, 4);
    IF v_max_p < 2 OR v_max_p > 4 THEN
        v_max_p := 4;
    END IF;
    
    SELECT cash, username INTO v_current_cash, v_username
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;
    
    IF v_current_cash < p_bet_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;
    
    v_new_cash := v_current_cash - p_bet_amount;
    UPDATE public.users
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;
    
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_new_cash, 'UNO Room Entry Fee (Host)',
            jsonb_build_object('game', 'uno', 'action', 'create_room'));
    
    -- Create room (minimal data now)
    INSERT INTO uno_rooms (host_id, bet_amount, pot_amount, max_players, player_order)
    VALUES (p_user_id, p_bet_amount, p_bet_amount, v_max_p, ARRAY[p_user_id])
    RETURNING id INTO v_room_id;
    
    -- Create public state
    INSERT INTO uno_public_states (room_id, player_count, status, last_event, last_event_user_id)
    VALUES (v_room_id, 1, 'waiting', 'room_created', p_user_id);
    
    -- Create hidden state (empty for now)
    INSERT INTO uno_hidden_states (room_id, deck, player_hands)
    VALUES (v_room_id, '[]'::jsonb, '{}'::jsonb);
    
    -- Add host as first player
    INSERT INTO uno_players (room_id, user_id, username, seat_index, is_ready, has_paid)
    VALUES (v_room_id, p_user_id, v_username, 0, true, true);
    
    RETURN jsonb_build_object(
        'success', true,
        'roomId', v_room_id,
        'newBalance', v_new_cash
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Join UNO Room (Updated for split state)
-- ========================================
CREATE OR REPLACE FUNCTION fn_join_uno_room(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_username TEXT;
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_room RECORD;
    v_player_count INTEGER;
    v_seat_index INTEGER;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    SELECT * INTO v_room
    FROM uno_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;
    
    IF v_room.status != 'waiting' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game already started');
    END IF;
    
    IF EXISTS (SELECT 1 FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
        SELECT cash INTO v_current_cash FROM public.users WHERE id = p_user_id;
        RETURN jsonb_build_object('success', true, 'newBalance', v_current_cash, 'alreadyInRoom', true);
    END IF;
    
    SELECT COUNT(*) INTO v_player_count FROM uno_players WHERE room_id = p_room_id;
    
    IF v_player_count >= v_room.max_players THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room is full');
    END IF;
    
    SELECT cash, username INTO v_current_cash, v_username
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;
    
    IF v_current_cash < v_room.bet_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;
    
    v_new_cash := v_current_cash - v_room.bet_amount;
    UPDATE public.users
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;
    
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', v_room.bet_amount, v_new_cash, 'UNO Room Entry Fee',
            jsonb_build_object('game', 'uno', 'room_id', p_room_id));
    
    UPDATE uno_rooms
    SET pot_amount = pot_amount + v_room.bet_amount,
        player_order = array_append(player_order, p_user_id),
        updated_at = NOW()
    WHERE id = p_room_id;
    
    v_seat_index := v_player_count;
    INSERT INTO uno_players (room_id, user_id, username, seat_index, has_paid)
    VALUES (p_room_id, p_user_id, v_username, v_seat_index, true);
    
    -- Update public state (triggers Realtime for lobby sync!)
    UPDATE uno_public_states
    SET player_count = v_player_count + 1,
        last_event = 'player_joined',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'newBalance', v_new_cash,
        'seatIndex', v_seat_index
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Leave UNO Room (Updated for split state)
-- ========================================
CREATE OR REPLACE FUNCTION fn_leave_uno_room(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_player RECORD;
    v_remaining_count INTEGER;
    v_winner_id UUID;
    v_winner_username TEXT;
    v_new_cash NUMERIC;
    v_public_status TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    SELECT * INTO v_room
    FROM uno_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;
    
    SELECT * INTO v_player
    FROM uno_players
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not in this room');
    END IF;
    
    -- Get current status from public state
    SELECT status INTO v_public_status FROM uno_public_states WHERE room_id = p_room_id;
    
    IF v_public_status = 'waiting' THEN
        -- Refund
        UPDATE public.users
        SET cash = cash + v_room.bet_amount, updated_at = NOW()
        WHERE id = p_user_id
        RETURNING cash INTO v_new_cash;
        
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'win', v_room.bet_amount, v_new_cash, 'UNO Room Refund (Left Waiting)',
                jsonb_build_object('game', 'uno', 'room_id', p_room_id));
        
        UPDATE uno_rooms
        SET pot_amount = pot_amount - v_room.bet_amount,
            player_order = array_remove(player_order, p_user_id),
            updated_at = NOW()
        WHERE id = p_room_id;
        
        DELETE FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
        
        SELECT COUNT(*) INTO v_remaining_count FROM uno_players WHERE room_id = p_room_id;
        
        -- Update public state
        UPDATE uno_public_states
        SET player_count = v_remaining_count,
            last_event = 'player_left',
            last_event_user_id = p_user_id,
            updated_at = NOW()
        WHERE room_id = p_room_id;
        
        IF p_user_id = v_room.host_id THEN
            IF v_remaining_count = 0 THEN
                -- Delete all related records
                DELETE FROM uno_hidden_states WHERE room_id = p_room_id;
                DELETE FROM uno_public_states WHERE room_id = p_room_id;
                DELETE FROM uno_rooms WHERE id = p_room_id;
            ELSE
                SELECT user_id INTO v_winner_id FROM uno_players WHERE room_id = p_room_id ORDER BY seat_index LIMIT 1;
                UPDATE uno_rooms SET host_id = v_winner_id WHERE id = p_room_id;
            END IF;
        END IF;
        
        RETURN jsonb_build_object('success', true, 'refunded', true, 'newBalance', v_new_cash);
        
    ELSIF v_public_status = 'playing' THEN
        -- Forfeit (no refund)
        UPDATE uno_rooms
        SET player_order = array_remove(player_order, p_user_id),
            updated_at = NOW()
        WHERE id = p_room_id;
        
        -- Remove player's hand from hidden state
        UPDATE uno_hidden_states
        SET player_hands = player_hands - p_user_id::TEXT
        WHERE room_id = p_room_id;
        
        DELETE FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
        
        SELECT COUNT(*) INTO v_remaining_count FROM uno_players WHERE room_id = p_room_id;
        
        IF v_remaining_count = 1 THEN
            -- Last player wins
            SELECT user_id, username INTO v_winner_id, v_winner_username
            FROM uno_players
            WHERE room_id = p_room_id
            LIMIT 1;
            
            UPDATE public.users
            SET cash = cash + v_room.pot_amount, updated_at = NOW()
            WHERE id = v_winner_id
            RETURNING cash INTO v_new_cash;
            
            INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
            VALUES (v_winner_id, 'win', v_room.pot_amount, v_new_cash, 'UNO Game Win (Last Player Standing)',
                    jsonb_build_object('game', 'uno', 'room_id', p_room_id));
            
            UPDATE uno_public_states
            SET status = 'finished',
                winner_id = v_winner_id,
                winner_username = v_winner_username,
                last_event = 'game_over',
                last_event_user_id = v_winner_id,
                updated_at = NOW()
            WHERE room_id = p_room_id;
            
            UPDATE uno_rooms SET status = 'finished' WHERE id = p_room_id;
            
        ELSIF v_remaining_count = 0 THEN
            UPDATE uno_public_states
            SET status = 'finished',
                last_event = 'game_cancelled',
                updated_at = NOW()
            WHERE room_id = p_room_id;
            
            UPDATE uno_rooms SET status = 'finished' WHERE id = p_room_id;
        ELSE
            -- Adjust turn if needed
            DECLARE
                v_current_turn INTEGER;
            BEGIN
                SELECT current_turn_index INTO v_current_turn FROM uno_public_states WHERE room_id = p_room_id;
                IF v_current_turn >= v_remaining_count THEN
                    UPDATE uno_public_states
                    SET current_turn_index = 0,
                        turn_started_at = NOW(),
                        player_count = v_remaining_count,
                        last_event = 'player_left',
                        last_event_user_id = p_user_id,
                        updated_at = NOW()
                    WHERE room_id = p_room_id;
                ELSE
                    UPDATE uno_public_states
                    SET player_count = v_remaining_count,
                        last_event = 'player_left',
                        last_event_user_id = p_user_id,
                        updated_at = NOW()
                    WHERE room_id = p_room_id;
                END IF;
            END;
        END IF;
        
        RETURN jsonb_build_object('success', true, 'refunded', false);
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Game already finished');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Delete UNO Room (Host Only)
-- ========================================
CREATE OR REPLACE FUNCTION fn_delete_uno_room(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_player RECORD;
    v_refund_amount NUMERIC;
    v_public_status TEXT;
BEGIN
    SELECT * INTO v_room
    FROM uno_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;
    
    IF v_room.host_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only the host can delete the room');
    END IF;
    
    SELECT status INTO v_public_status FROM uno_public_states WHERE room_id = p_room_id;
    
    IF v_public_status = 'playing' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot delete a room while game is in progress');
    END IF;
    
    v_refund_amount := v_room.bet_amount;
    
    FOR v_player IN SELECT * FROM uno_players WHERE room_id = p_room_id LOOP
        UPDATE public.users
        SET cash = cash + v_refund_amount, updated_at = NOW()
        WHERE id = v_player.user_id;
        
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        SELECT v_player.user_id, 'refund', v_refund_amount, cash, 'UNO Room Deleted by Host',
               jsonb_build_object('game', 'uno', 'room_id', p_room_id)
        FROM public.users WHERE id = v_player.user_id;
    END LOOP;
    
    DELETE FROM uno_players WHERE room_id = p_room_id;
    DELETE FROM uno_hidden_states WHERE room_id = p_room_id;
    DELETE FROM uno_public_states WHERE room_id = p_room_id;
    DELETE FROM uno_rooms WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Room deleted and all players refunded');

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Start UNO Game (Updated for split state)
-- ========================================
CREATE OR REPLACE FUNCTION fn_start_uno_game(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_player_count INTEGER;
    v_deck JSONB;
    v_top_card JSONB;
    v_player RECORD;
    v_hand JSONB;
    v_card JSONB;
    v_player_hands JSONB := '{}'::jsonb;
    v_public_status TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    SELECT * INTO v_room
    FROM uno_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;
    
    IF v_room.host_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only host can start game');
    END IF;
    
    SELECT status INTO v_public_status FROM uno_public_states WHERE room_id = p_room_id;
    
    IF v_public_status != 'waiting' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game already started');
    END IF;
    
    SELECT COUNT(*) INTO v_player_count FROM uno_players WHERE room_id = p_room_id;
    
    IF v_player_count < 2 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Need at least 2 players');
    END IF;
    
    IF EXISTS (SELECT 1 FROM uno_players WHERE room_id = p_room_id AND has_paid = false) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not all players have paid');
    END IF;
    
    -- Generate and shuffle deck
    v_deck := shuffle_jsonb_array(generate_uno_deck());
    
    -- Deal 7 cards to each player
    FOR v_player IN SELECT * FROM uno_players WHERE room_id = p_room_id ORDER BY seat_index LOOP
        v_hand := '[]'::jsonb;
        FOR i IN 1..7 LOOP
            v_card := v_deck->0;
            v_deck := v_deck - 0;
            v_hand := v_hand || jsonb_build_array(v_card);
        END LOOP;
        
        -- Store hand in JSONB map
        v_player_hands := v_player_hands || jsonb_build_object(v_player.user_id::TEXT, v_hand);
    END LOOP;
    
    -- Find first number card for top
    LOOP
        v_top_card := v_deck->0;
        v_deck := v_deck - 0;
        
        IF (v_top_card->>'type') = 'number' THEN
            EXIT;
        ELSE
            v_deck := v_deck || jsonb_build_array(v_top_card);
        END IF;
    END LOOP;
    
    -- Update hidden state with deck and hands
    UPDATE uno_hidden_states
    SET deck = v_deck,
        player_hands = v_player_hands
    WHERE room_id = p_room_id;
    
    -- Set hand_count for all players (7 cards each at start)
    UPDATE uno_players
    SET hand_count = 7
    WHERE room_id = p_room_id;
    
    -- Update public state (triggers Realtime!)
    UPDATE uno_public_states
    SET status = 'playing',
        top_card = v_top_card,
        current_color = v_top_card->>'color',
        current_turn_index = 0,
        direction = 1,
        turn_started_at = NOW(),
        last_event = 'game_started',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    -- Update room status
    UPDATE uno_rooms
    SET status = 'playing',
        updated_at = NOW()
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'topCard', v_top_card,
        'playerCount', v_player_count
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Play Card (Updated for split state)
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_play_card(
    p_user_id UUID,
    p_room_id UUID,
    p_card_index INTEGER,
    p_wild_color TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_public_state RECORD;
    v_hidden_state RECORD;
    v_card JSONB;
    v_played_card JSONB;
    v_current_player_id UUID;
    v_next_turn INTEGER;
    v_player_count INTEGER;
    v_remaining_cards INTEGER;
    v_winner_id UUID;
    v_winner_username TEXT;
    v_new_cash NUMERIC;
    v_draw_cards INTEGER := 0;
    v_skip_next BOOLEAN := false;
    v_my_hand JSONB;
    v_new_hand JSONB;
    v_victim_user_id UUID;
    v_victim_index INTEGER;
    v_victim_hand JSONB;
    v_deck_card JSONB;
    v_arr_len INTEGER;
    i INTEGER;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    -- Lock room
    SELECT * INTO v_room
    FROM uno_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;
    
    -- Get public state
    SELECT * INTO v_public_state
    FROM uno_public_states
    WHERE room_id = p_room_id
    FOR UPDATE;
    
    IF v_public_state.status != 'playing' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not in progress');
    END IF;
    
    -- Check turn
    v_current_player_id := v_room.player_order[v_public_state.current_turn_index + 1];
    IF v_current_player_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not your turn');
    END IF;
    
    -- Get hidden state
    SELECT * INTO v_hidden_state
    FROM uno_hidden_states
    WHERE room_id = p_room_id
    FOR UPDATE;
    
    -- Get player's hand
    v_my_hand := v_hidden_state.player_hands->p_user_id::TEXT;
    v_card := v_my_hand->p_card_index;
    v_played_card := v_card;
    
    IF v_card IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid card index');
    END IF;
    
    -- Validate card can be played
    IF (v_card->>'type') != 'wild' THEN
        IF (v_card->>'color') != v_public_state.current_color AND (v_card->>'value') != (v_public_state.top_card->>'value') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Card cannot be played');
        END IF;
    END IF;
    
    IF (v_card->>'type') = 'wild' AND p_wild_color IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Must select color for wild card');
    END IF;
    
    -- Remove card from hand
    v_new_hand := '[]'::jsonb;
    FOR i IN 0..jsonb_array_length(v_my_hand) - 1 LOOP
        IF i != p_card_index THEN
            v_new_hand := v_new_hand || jsonb_build_array(v_my_hand->i);
        END IF;
    END LOOP;
    v_remaining_cards := jsonb_array_length(v_new_hand);
    
    -- Update player hands in hidden state
    UPDATE uno_hidden_states
    SET player_hands = jsonb_set(player_hands, ARRAY[p_user_id::TEXT], v_new_hand)
    WHERE room_id = p_room_id;
    
    -- Update hand_count for player who played
    UPDATE uno_players 
    SET hand_count = v_remaining_cards, has_called_uno = false 
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    SELECT COUNT(*) INTO v_player_count FROM uno_players WHERE room_id = p_room_id;
    
    -- Handle special cards
    CASE v_card->>'value'
        WHEN 'reverse' THEN
            v_public_state.direction := v_public_state.direction * -1;
            IF v_player_count = 2 THEN
                v_skip_next := true;
            END IF;
            
        WHEN 'skip' THEN
            v_skip_next := true;
            
        WHEN '+2' THEN
            v_skip_next := true;
            v_draw_cards := 2;
            
        WHEN '+4' THEN
            v_skip_next := true;
            v_draw_cards := 4;
            
        ELSE
            NULL;
    END CASE;
    
    -- Calculate next turn
    v_next_turn := v_public_state.current_turn_index + v_public_state.direction;
    
    IF v_skip_next THEN
        v_next_turn := v_next_turn + v_public_state.direction;
    END IF;
    
    -- Wrap around
    IF v_next_turn < 0 THEN
        v_next_turn := v_player_count + v_next_turn;
    END IF;
    v_next_turn := v_next_turn % v_player_count;
    
    -- Handle +2/+4: Make victim draw cards
    IF v_draw_cards > 0 THEN
        v_arr_len := array_length(v_room.player_order, 1);
        v_victim_index := v_public_state.current_turn_index + v_public_state.direction;
        
        IF v_victim_index < 0 THEN
            v_victim_index := v_arr_len + v_victim_index;
        END IF;
        v_victim_index := v_victim_index % v_arr_len;
        
        v_victim_user_id := v_room.player_order[v_victim_index + 1];
        
        IF v_victim_user_id IS NOT NULL THEN
            -- Refetch hidden state for current deck
            SELECT * INTO v_hidden_state FROM uno_hidden_states WHERE room_id = p_room_id;
            v_victim_hand := v_hidden_state.player_hands->v_victim_user_id::TEXT;
            
            FOR i IN 1..v_draw_cards LOOP
                -- Check if deck needs reshuffle
                IF v_hidden_state.deck IS NULL OR jsonb_array_length(v_hidden_state.deck) = 0 THEN
                    UPDATE uno_hidden_states
                    SET deck = shuffle_jsonb_array(generate_uno_deck())
                    WHERE room_id = p_room_id;
                    SELECT * INTO v_hidden_state FROM uno_hidden_states WHERE room_id = p_room_id;
                END IF;
                
                IF v_hidden_state.deck IS NOT NULL AND jsonb_array_length(v_hidden_state.deck) > 0 THEN
                    v_deck_card := v_hidden_state.deck->0;
                    v_victim_hand := v_victim_hand || jsonb_build_array(v_deck_card);
                    
                    UPDATE uno_hidden_states
                    SET deck = deck - 0,
                        player_hands = jsonb_set(player_hands, ARRAY[v_victim_user_id::TEXT], v_victim_hand)
                    WHERE room_id = p_room_id;
                    
                    SELECT * INTO v_hidden_state FROM uno_hidden_states WHERE room_id = p_room_id;
                END IF;
            END LOOP;
            
            -- Update victim's hand_count after receiving cards
            UPDATE uno_players 
            SET hand_count = jsonb_array_length(v_victim_hand)
            WHERE room_id = p_room_id AND user_id = v_victim_user_id;
        END IF;
    END IF;
    
    -- Update public state (Triggers Realtime!)
    UPDATE uno_public_states
    SET top_card = v_played_card,
        current_color = COALESCE(p_wild_color, v_played_card->>'color'),
        current_turn_index = v_next_turn,
        direction = v_public_state.direction,
        turn_started_at = NOW(),
        last_event = 'card_played',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    -- Check win condition
    IF v_remaining_cards = 0 THEN
        v_winner_id := p_user_id;
        SELECT username INTO v_winner_username FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
        
        UPDATE public.users
        SET cash = cash + v_room.pot_amount, updated_at = NOW()
        WHERE id = v_winner_id
        RETURNING cash INTO v_new_cash;
        
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (v_winner_id, 'win', v_room.pot_amount, v_new_cash, 'UNO Game Win',
                jsonb_build_object('game', 'uno', 'room_id', p_room_id));
        
        UPDATE uno_public_states
        SET status = 'finished',
            winner_id = v_winner_id,
            winner_username = v_winner_username,
            last_event = 'game_over',
            updated_at = NOW()
        WHERE room_id = p_room_id;
        
        UPDATE uno_rooms SET status = 'finished' WHERE id = p_room_id;
        
        RETURN jsonb_build_object(
            'success', true,
            'gameOver', true,
            'winner', v_winner_username,
            'winAmount', v_room.pot_amount,
            'newBalance', v_new_cash
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'cardPlayed', v_played_card,
        'remainingCards', v_remaining_cards,
        'nextTurn', v_next_turn
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Draw Card (Updated for split state)
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_draw_card(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_public_state RECORD;
    v_hidden_state RECORD;
    v_current_player_id UUID;
    v_card JSONB;
    v_next_turn INTEGER;
    v_player_count INTEGER;
    v_my_hand JSONB;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    SELECT * INTO v_room
    FROM uno_rooms
    WHERE id = p_room_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;
    
    SELECT * INTO v_public_state
    FROM uno_public_states
    WHERE room_id = p_room_id
    FOR UPDATE;
    
    IF v_public_state.status != 'playing' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not in progress');
    END IF;
    
    v_current_player_id := v_room.player_order[v_public_state.current_turn_index + 1];
    IF v_current_player_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not your turn');
    END IF;
    
    SELECT * INTO v_hidden_state
    FROM uno_hidden_states
    WHERE room_id = p_room_id
    FOR UPDATE;
    
    -- If deck is empty, reshuffle
    IF jsonb_array_length(v_hidden_state.deck) = 0 THEN
        UPDATE uno_hidden_states
        SET deck = shuffle_jsonb_array(generate_uno_deck())
        WHERE room_id = p_room_id;
        
        SELECT * INTO v_hidden_state FROM uno_hidden_states WHERE room_id = p_room_id;
        
        IF jsonb_array_length(v_hidden_state.deck) = 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Could not regenerate deck');
        END IF;
    END IF;
    
    v_card := v_hidden_state.deck->0;
    v_my_hand := v_hidden_state.player_hands->p_user_id::TEXT;
    v_my_hand := v_my_hand || jsonb_build_array(v_card);
    
    -- Update hidden state
    UPDATE uno_hidden_states
    SET deck = deck - 0,
        player_hands = jsonb_set(player_hands, ARRAY[p_user_id::TEXT], v_my_hand)
    WHERE room_id = p_room_id;
    
    -- Update hand_count for player who drew
    UPDATE uno_players 
    SET hand_count = jsonb_array_length(v_my_hand), has_called_uno = false 
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    -- Calculate next turn
    SELECT COUNT(*) INTO v_player_count FROM uno_players WHERE room_id = p_room_id;
    v_next_turn := v_public_state.current_turn_index + v_public_state.direction;
    
    IF v_next_turn < 0 THEN
        v_next_turn := v_player_count + v_next_turn;
    END IF;
    v_next_turn := v_next_turn % v_player_count;
    
    -- Update public state (Triggers Realtime!)
    UPDATE uno_public_states
    SET current_turn_index = v_next_turn,
        turn_started_at = NOW(),
        last_event = 'card_drawn',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'drawnCard', v_card,
        'nextTurn', v_next_turn
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Toggle Ready
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_toggle_ready(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_new_ready BOOLEAN;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    UPDATE uno_players
    SET is_ready = NOT is_ready
    WHERE room_id = p_room_id AND user_id = p_user_id
    RETURNING is_ready INTO v_new_ready;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not in this room');
    END IF;
    
    -- Update public state to trigger sync
    UPDATE uno_public_states
    SET last_event = 'player_ready',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'isReady', v_new_ready);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Call UNO
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_call_uno(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_hand JSONB;
    v_hand_count INTEGER;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    SELECT player_hands->p_user_id::TEXT INTO v_hand
    FROM uno_hidden_states
    WHERE room_id = p_room_id;
    
    IF v_hand IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not in this room');
    END IF;
    
    v_hand_count := jsonb_array_length(v_hand);
    
    IF v_hand_count > 2 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Can only call UNO with 1-2 cards');
    END IF;
    
    UPDATE uno_players
    SET has_called_uno = true
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    -- Update public state to notify others
    UPDATE uno_public_states
    SET last_event = 'uno_called',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object('success', true);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Get Available Rooms
-- ========================================
CREATE OR REPLACE FUNCTION fn_get_uno_rooms()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_rooms JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(room_data), '[]'::jsonb)
    INTO v_rooms
    FROM (
        SELECT jsonb_build_object(
            'id', r.id,
            'host_id', r.host_id,
            'host_username', (SELECT username FROM public.users WHERE id = r.host_id),
            'bet_amount', r.bet_amount,
            'pot_amount', r.pot_amount,
            'max_players', r.max_players,
            'player_count', ps.player_count,
            'status', ps.status,
            'created_at', r.created_at
        ) as room_data
        FROM uno_rooms r
        JOIN uno_public_states ps ON ps.room_id = r.id
        WHERE ps.status = 'waiting'
        ORDER BY r.created_at DESC
        LIMIT 20
    ) sub;
    
    RETURN jsonb_build_object('success', true, 'rooms', v_rooms);
END;
$$;

-- ========================================
-- RPC: Cleanup Stale Rooms
-- ========================================
CREATE OR REPLACE FUNCTION fn_cleanup_stale_uno_rooms(
    p_inactivity_minutes INTEGER DEFAULT 10
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_stale_room RECORD;
    v_player RECORD;
    v_cleaned_count INTEGER := 0;
    v_cutoff_time TIMESTAMPTZ;
BEGIN
    v_cutoff_time := NOW() - (p_inactivity_minutes || ' minutes')::INTERVAL;
    
    FOR v_stale_room IN 
        SELECT r.* FROM uno_rooms r
        JOIN uno_public_states ps ON ps.room_id = r.id
        WHERE ps.status = 'waiting' 
        AND ps.updated_at < v_cutoff_time
        FOR UPDATE OF r
    LOOP
        FOR v_player IN 
            SELECT * FROM uno_players 
            WHERE room_id = v_stale_room.id
        LOOP
            UPDATE public.users
            SET cash = cash + v_stale_room.bet_amount, updated_at = NOW()
            WHERE id = v_player.user_id;
            
            INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
            SELECT v_player.user_id, 'refund', v_stale_room.bet_amount, cash, 'UNO Room Auto-Cleanup (Inactivity)',
                   jsonb_build_object('game', 'uno', 'room_id', v_stale_room.id)
            FROM public.users WHERE id = v_player.user_id;
        END LOOP;
        
        DELETE FROM uno_players WHERE room_id = v_stale_room.id;
        DELETE FROM uno_hidden_states WHERE room_id = v_stale_room.id;
        DELETE FROM uno_public_states WHERE room_id = v_stale_room.id;
        DELETE FROM uno_rooms WHERE id = v_stale_room.id;
        
        v_cleaned_count := v_cleaned_count + 1;
    END LOOP;
    
    RETURN jsonb_build_object('success', true, 'cleaned_count', v_cleaned_count);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'cleaned_count', v_cleaned_count);
END;
$$;

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================
ALTER TABLE uno_public_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE uno_hidden_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on uno_public_states" ON uno_public_states;
DROP POLICY IF EXISTS "Allow all on uno_hidden_states" ON uno_hidden_states;

CREATE POLICY "Allow all on uno_public_states" ON uno_public_states FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on uno_hidden_states" ON uno_hidden_states FOR ALL USING (true) WITH CHECK (true);

-- ========================================
-- GRANT PERMISSIONS
-- ========================================
GRANT EXECUTE ON FUNCTION fn_create_uno_room(UUID, NUMERIC, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_join_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_start_uno_game(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_leave_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_play_card(UUID, UUID, INTEGER, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_draw_card(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_toggle_ready(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_call_uno(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_get_uno_rooms() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_delete_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_cleanup_stale_uno_rooms(INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_get_my_hand(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION generate_uno_deck() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION shuffle_jsonb_array(JSONB) TO authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON uno_public_states TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON uno_hidden_states TO authenticated, anon;

-- ========================================
-- ENABLE REALTIME (ONLY for public_states!)
-- ========================================
ALTER PUBLICATION supabase_realtime ADD TABLE uno_public_states;

-- NOTE: uno_hidden_states is intentionally NOT added to realtime
-- This is the key optimization - heavy data (deck/hands) is never broadcast
