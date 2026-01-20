-- ========================================
-- UNO GAME LOGIC - COMPLETE REWRITE
-- Run this in Supabase SQL Editor
-- ========================================

-- ========================================
-- TABLES (Create if not exist)
-- ========================================

CREATE TABLE IF NOT EXISTS uno_public_states (
    room_id UUID PRIMARY KEY REFERENCES uno_rooms(id) ON DELETE CASCADE,
    current_turn_index INTEGER DEFAULT 0,
    direction INTEGER DEFAULT 1,
    top_card JSONB DEFAULT NULL,
    current_color TEXT DEFAULT NULL,
    turn_started_at TIMESTAMPTZ DEFAULT NULL,
    status TEXT DEFAULT 'waiting',
    player_count INTEGER DEFAULT 0,
    winner_id UUID DEFAULT NULL,
    winner_username TEXT DEFAULT NULL,
    last_event TEXT DEFAULT NULL,
    last_event_user_id UUID DEFAULT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uno_hidden_states (
    room_id UUID PRIMARY KEY REFERENCES uno_rooms(id) ON DELETE CASCADE,
    deck JSONB DEFAULT '[]'::jsonb,
    player_hands JSONB DEFAULT '{}'::jsonb
);

-- Add hand_count column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uno_players' AND column_name = 'hand_count') THEN
        ALTER TABLE uno_players ADD COLUMN hand_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Enable Realtime
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE uno_public_states;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- ========================================
-- HELPER: Generate Standard UNO Deck
-- ========================================
CREATE OR REPLACE FUNCTION generate_uno_deck()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
    v_deck JSONB := '[]'::jsonb;
    v_colors TEXT[] := ARRAY['red', 'blue', 'green', 'yellow'];
    v_color TEXT;
    v_card_id INTEGER := 1;
BEGIN
    FOREACH v_color IN ARRAY v_colors LOOP
        -- One 0 per color
        v_deck := v_deck || jsonb_build_array(jsonb_build_object(
            'id', v_card_id, 'color', v_color, 'value', '0', 'type', 'number'
        ));
        v_card_id := v_card_id + 1;
        
        -- Two of each 1-9
        FOR i IN 1..9 LOOP
            FOR j IN 1..2 LOOP
                v_deck := v_deck || jsonb_build_array(jsonb_build_object(
                    'id', v_card_id, 'color', v_color, 'value', i::TEXT, 'type', 'number'
                ));
                v_card_id := v_card_id + 1;
            END LOOP;
        END LOOP;
        
        -- Two Skip, Reverse, +2 per color
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_card_id, 'color', v_color, 'value', 'skip', 'type', 'action'));
            v_card_id := v_card_id + 1;
        END LOOP;
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_card_id, 'color', v_color, 'value', 'reverse', 'type', 'action'));
            v_card_id := v_card_id + 1;
        END LOOP;
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_card_id, 'color', v_color, 'value', '+2', 'type', 'action'));
            v_card_id := v_card_id + 1;
        END LOOP;
    END LOOP;
    
    -- Four Wild and +4 cards
    FOR j IN 1..4 LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_card_id, 'color', NULL, 'value', 'wild', 'type', 'wild'));
        v_card_id := v_card_id + 1;
    END LOOP;
    FOR j IN 1..4 LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_card_id, 'color', NULL, 'value', '+4', 'type', 'wild'));
        v_card_id := v_card_id + 1;
    END LOOP;
    
    RETURN v_deck;
END;
$$;

-- ========================================
-- HELPER: Shuffle JSONB Array
-- ========================================
CREATE OR REPLACE FUNCTION shuffle_jsonb_array(p_arr JSONB)
RETURNS JSONB
LANGUAGE plpgsql AS $$
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
-- HELPER: Calculate Next Turn Index
-- ========================================
CREATE OR REPLACE FUNCTION calc_next_turn(
    p_current INTEGER,
    p_direction INTEGER,
    p_player_count INTEGER,
    p_skip BOOLEAN DEFAULT FALSE
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    v_next INTEGER;
BEGIN
    -- Calculate base next
    v_next := p_current + p_direction;
    
    -- If skip, add another step
    IF p_skip THEN
        v_next := v_next + p_direction;
    END IF;
    
    -- Handle wraparound (both positive and negative)
    v_next := v_next % p_player_count;
    IF v_next < 0 THEN
        v_next := v_next + p_player_count;
    END IF;
    
    RETURN v_next;
END;
$$;

-- ========================================
-- RPC: Get My Hand
-- ========================================
CREATE OR REPLACE FUNCTION fn_get_my_hand(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN COALESCE(
        (SELECT player_hands->p_user_id::TEXT FROM uno_hidden_states WHERE room_id = p_room_id),
        '[]'::jsonb
    );
END;
$$;

-- ========================================
-- RPC: Create Room
-- ========================================
CREATE OR REPLACE FUNCTION fn_create_uno_room(p_user_id UUID, p_bet_amount NUMERIC, p_max_players INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_username TEXT;
    v_cash NUMERIC;
    v_new_cash NUMERIC;
    v_room_id UUID;
    v_max INTEGER;
BEGIN
    IF p_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'User ID required'); END IF;
    IF p_bet_amount < 10 THEN RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is $10'); END IF;
    IF p_bet_amount > 10000 THEN RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is $10,000'); END IF;
    
    v_max := GREATEST(2, LEAST(4, COALESCE(p_max_players, 4)));
    
    SELECT cash, username INTO v_cash, v_username FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'User not found'); END IF;
    IF v_cash < p_bet_amount THEN RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance'); END IF;
    
    v_new_cash := v_cash - p_bet_amount;
    UPDATE public.users SET cash = v_new_cash, updated_at = NOW() WHERE id = p_user_id;
    
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_new_cash, 'UNO Room Entry', jsonb_build_object('game', 'uno'));
    
    INSERT INTO uno_rooms (host_id, bet_amount, pot_amount, max_players, player_order)
    VALUES (p_user_id, p_bet_amount, p_bet_amount, v_max, ARRAY[p_user_id])
    RETURNING id INTO v_room_id;
    
    INSERT INTO uno_public_states (room_id, player_count, status, last_event, last_event_user_id)
    VALUES (v_room_id, 1, 'waiting', 'room_created', p_user_id);
    
    INSERT INTO uno_hidden_states (room_id, deck, player_hands)
    VALUES (v_room_id, '[]'::jsonb, '{}'::jsonb);
    
    INSERT INTO uno_players (room_id, user_id, username, seat_index, is_ready, has_paid)
    VALUES (v_room_id, p_user_id, v_username, 0, true, true);
    
    RETURN jsonb_build_object('success', true, 'roomId', v_room_id, 'newBalance', v_new_cash);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Join Room
-- ========================================
CREATE OR REPLACE FUNCTION fn_join_uno_room(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_username TEXT;
    v_cash NUMERIC;
    v_new_cash NUMERIC;
    v_room RECORD;
    v_count INTEGER;
BEGIN
    IF p_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'User ID required'); END IF;
    
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.status != 'waiting' THEN RETURN jsonb_build_object('success', false, 'error', 'Game already started'); END IF;
    
    IF EXISTS (SELECT 1 FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
        SELECT cash INTO v_cash FROM public.users WHERE id = p_user_id;
        RETURN jsonb_build_object('success', true, 'newBalance', v_cash, 'alreadyInRoom', true);
    END IF;
    
    SELECT COUNT(*) INTO v_count FROM uno_players WHERE room_id = p_room_id;
    IF v_count >= v_room.max_players THEN RETURN jsonb_build_object('success', false, 'error', 'Room is full'); END IF;
    
    SELECT cash, username INTO v_cash, v_username FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF v_cash < v_room.bet_amount THEN RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance'); END IF;
    
    v_new_cash := v_cash - v_room.bet_amount;
    UPDATE public.users SET cash = v_new_cash, updated_at = NOW() WHERE id = p_user_id;
    
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', v_room.bet_amount, v_new_cash, 'UNO Room Entry', jsonb_build_object('game', 'uno', 'room_id', p_room_id));
    
    UPDATE uno_rooms SET pot_amount = pot_amount + v_room.bet_amount, player_order = array_append(player_order, p_user_id), updated_at = NOW() WHERE id = p_room_id;
    
    INSERT INTO uno_players (room_id, user_id, username, seat_index, has_paid)
    VALUES (p_room_id, p_user_id, v_username, v_count, true);
    
    UPDATE uno_public_states SET player_count = v_count + 1, last_event = 'player_joined', last_event_user_id = p_user_id, updated_at = NOW() WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'newBalance', v_new_cash, 'seatIndex', v_count);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Leave Room
-- ========================================
CREATE OR REPLACE FUNCTION fn_leave_uno_room(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_status TEXT;
    v_new_cash NUMERIC;
    v_remaining INTEGER;
    v_winner_id UUID;
    v_winner_name TEXT;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF NOT EXISTS (SELECT 1 FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not in this room');
    END IF;
    
    SELECT status INTO v_status FROM uno_public_states WHERE room_id = p_room_id;
    
    IF v_status = 'waiting' THEN
        -- Refund
        UPDATE public.users SET cash = cash + v_room.bet_amount, updated_at = NOW() WHERE id = p_user_id RETURNING cash INTO v_new_cash;
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'win', v_room.bet_amount, v_new_cash, 'UNO Refund', jsonb_build_object('game', 'uno', 'room_id', p_room_id));
        
        UPDATE uno_rooms SET pot_amount = pot_amount - v_room.bet_amount, player_order = array_remove(player_order, p_user_id), updated_at = NOW() WHERE id = p_room_id;
        DELETE FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
        
        SELECT COUNT(*) INTO v_remaining FROM uno_players WHERE room_id = p_room_id;
        UPDATE uno_public_states SET player_count = v_remaining, last_event = 'player_left', last_event_user_id = p_user_id, updated_at = NOW() WHERE room_id = p_room_id;
        
        IF p_user_id = v_room.host_id THEN
            IF v_remaining = 0 THEN
                DELETE FROM uno_hidden_states WHERE room_id = p_room_id;
                DELETE FROM uno_public_states WHERE room_id = p_room_id;
                DELETE FROM uno_rooms WHERE id = p_room_id;
            ELSE
                SELECT user_id INTO v_winner_id FROM uno_players WHERE room_id = p_room_id ORDER BY seat_index LIMIT 1;
                UPDATE uno_rooms SET host_id = v_winner_id WHERE id = p_room_id;
            END IF;
        END IF;
        
        RETURN jsonb_build_object('success', true, 'refunded', true, 'newBalance', v_new_cash);
        
    ELSIF v_status = 'playing' THEN
        -- Forfeit
        UPDATE uno_rooms SET player_order = array_remove(player_order, p_user_id), updated_at = NOW() WHERE id = p_room_id;
        UPDATE uno_hidden_states SET player_hands = player_hands - p_user_id::TEXT WHERE room_id = p_room_id;
        DELETE FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
        
        SELECT COUNT(*) INTO v_remaining FROM uno_players WHERE room_id = p_room_id;
        
        IF v_remaining = 1 THEN
            SELECT user_id, username INTO v_winner_id, v_winner_name FROM uno_players WHERE room_id = p_room_id LIMIT 1;
            UPDATE public.users SET cash = cash + v_room.pot_amount, updated_at = NOW() WHERE id = v_winner_id RETURNING cash INTO v_new_cash;
            INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
            VALUES (v_winner_id, 'win', v_room.pot_amount, v_new_cash, 'UNO Win', jsonb_build_object('game', 'uno', 'room_id', p_room_id));
            
            UPDATE uno_public_states SET status = 'finished', winner_id = v_winner_id, winner_username = v_winner_name, last_event = 'game_over', updated_at = NOW() WHERE room_id = p_room_id;
            UPDATE uno_rooms SET status = 'finished' WHERE id = p_room_id;
        ELSE
            UPDATE uno_public_states SET player_count = v_remaining, last_event = 'player_left', last_event_user_id = p_user_id, updated_at = NOW() WHERE room_id = p_room_id;
        END IF;
        
        RETURN jsonb_build_object('success', true, 'refunded', false);
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Game already finished');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Delete Room
-- ========================================
CREATE OR REPLACE FUNCTION fn_delete_uno_room(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_player RECORD;
    v_status TEXT;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.host_id != p_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Only host can delete'); END IF;
    
    SELECT status INTO v_status FROM uno_public_states WHERE room_id = p_room_id;
    IF v_status = 'playing' THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot delete during game'); END IF;
    
    FOR v_player IN SELECT * FROM uno_players WHERE room_id = p_room_id LOOP
        UPDATE public.users SET cash = cash + v_room.bet_amount, updated_at = NOW() WHERE id = v_player.user_id;
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        SELECT v_player.user_id, 'win', v_room.bet_amount, cash, 'UNO Refund', jsonb_build_object('game', 'uno', 'room_id', p_room_id)
        FROM public.users WHERE id = v_player.user_id;
    END LOOP;
    
    DELETE FROM uno_players WHERE room_id = p_room_id;
    DELETE FROM uno_hidden_states WHERE room_id = p_room_id;
    DELETE FROM uno_public_states WHERE room_id = p_room_id;
    DELETE FROM uno_rooms WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Room deleted');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Start Game
-- ========================================
CREATE OR REPLACE FUNCTION fn_start_uno_game(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_count INTEGER;
    v_deck JSONB;
    v_top JSONB;
    v_player RECORD;
    v_hand JSONB;
    v_hands JSONB := '{}'::jsonb;
    v_status TEXT;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.host_id != p_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Only host can start'); END IF;
    
    SELECT status INTO v_status FROM uno_public_states WHERE room_id = p_room_id;
    IF v_status != 'waiting' THEN RETURN jsonb_build_object('success', false, 'error', 'Game already started'); END IF;
    
    SELECT COUNT(*) INTO v_count FROM uno_players WHERE room_id = p_room_id;
    IF v_count < 2 THEN RETURN jsonb_build_object('success', false, 'error', 'Need at least 2 players'); END IF;
    
    -- Generate shuffled deck
    v_deck := shuffle_jsonb_array(generate_uno_deck());
    
    -- Deal 7 cards to each player
    FOR v_player IN SELECT * FROM uno_players WHERE room_id = p_room_id ORDER BY seat_index LOOP
        v_hand := '[]'::jsonb;
        FOR i IN 1..7 LOOP
            v_hand := v_hand || jsonb_build_array(v_deck->0);
            v_deck := v_deck - 0;
        END LOOP;
        v_hands := v_hands || jsonb_build_object(v_player.user_id::TEXT, v_hand);
    END LOOP;
    
    -- Find first number card for discard pile
    LOOP
        v_top := v_deck->0;
        v_deck := v_deck - 0;
        IF (v_top->>'type') = 'number' THEN EXIT; END IF;
        v_deck := v_deck || jsonb_build_array(v_top);
    END LOOP;
    
    -- Save hidden state
    UPDATE uno_hidden_states SET deck = v_deck, player_hands = v_hands WHERE room_id = p_room_id;
    
    -- Set initial hand counts
    UPDATE uno_players SET hand_count = 7 WHERE room_id = p_room_id;
    
    -- Update public state
    UPDATE uno_public_states SET 
        status = 'playing',
        top_card = v_top,
        current_color = v_top->>'color',
        current_turn_index = 0,
        direction = 1,
        turn_started_at = NOW(),
        last_event = 'game_started',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    UPDATE uno_rooms SET status = 'playing', updated_at = NOW() WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'topCard', v_top, 'playerCount', v_count);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Play Card (CORE GAME LOGIC)
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_play_card(p_user_id UUID, p_room_id UUID, p_card_index INTEGER, p_wild_color TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_ps RECORD;       -- public state
    v_hs RECORD;       -- hidden state
    v_card JSONB;
    v_my_hand JSONB;
    v_new_hand JSONB;
    v_count INTEGER;
    v_remaining INTEGER;
    v_current_player UUID;
    v_next_turn INTEGER;
    v_new_direction INTEGER;
    v_skip BOOLEAN := false;
    v_draw_count INTEGER := 0;
    v_victim_id UUID;
    v_victim_hand JSONB;
    v_deck_card JSONB;
    v_winner_cash NUMERIC;
    i INTEGER;
BEGIN
    -- Lock and fetch room
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    
    SELECT * INTO v_ps FROM uno_public_states WHERE room_id = p_room_id FOR UPDATE;
    IF v_ps.status != 'playing' THEN RETURN jsonb_build_object('success', false, 'error', 'Game not in progress'); END IF;
    
    -- Verify it's this player's turn
    v_current_player := v_room.player_order[v_ps.current_turn_index + 1];
    IF v_current_player != p_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Not your turn'); END IF;
    
    -- Get hidden state
    SELECT * INTO v_hs FROM uno_hidden_states WHERE room_id = p_room_id FOR UPDATE;
    v_my_hand := v_hs.player_hands->p_user_id::TEXT;
    v_card := v_my_hand->p_card_index;
    
    IF v_card IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid card index'); END IF;
    
    -- Validate card is playable
    IF (v_card->>'type') != 'wild' THEN
        IF (v_card->>'color') != v_ps.current_color AND (v_card->>'value') != (v_ps.top_card->>'value') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Card cannot be played');
        END IF;
    END IF;
    
    IF (v_card->>'type') = 'wild' AND p_wild_color IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Must select color for wild');
    END IF;
    
    -- Remove card from hand
    v_new_hand := '[]'::jsonb;
    FOR i IN 0..jsonb_array_length(v_my_hand) - 1 LOOP
        IF i != p_card_index THEN
            v_new_hand := v_new_hand || jsonb_build_array(v_my_hand->i);
        END IF;
    END LOOP;
    v_remaining := jsonb_array_length(v_new_hand);
    
    -- Save updated hand
    UPDATE uno_hidden_states SET player_hands = jsonb_set(player_hands, ARRAY[p_user_id::TEXT], v_new_hand) WHERE room_id = p_room_id;
    UPDATE uno_players SET hand_count = v_remaining, has_called_uno = false WHERE room_id = p_room_id AND user_id = p_user_id;
    
    -- Get player count
    SELECT COUNT(*) INTO v_count FROM uno_players WHERE room_id = p_room_id;
    
    -- ========================================
    -- HANDLE SPECIAL CARDS
    -- ========================================
    v_new_direction := v_ps.direction;
    
    CASE v_card->>'value'
        WHEN 'reverse' THEN
            v_new_direction := v_ps.direction * -1;
            -- In 2-player, reverse acts as skip
            IF v_count = 2 THEN v_skip := true; END IF;
            
        WHEN 'skip' THEN
            v_skip := true;
            
        WHEN '+2' THEN
            v_skip := true;
            v_draw_count := 2;
            
        WHEN '+4' THEN
            v_skip := true;
            v_draw_count := 4;
            
        ELSE
            NULL; -- Normal card
    END CASE;
    
    -- ========================================
    -- CALCULATE VICTIM FOR +2/+4
    -- ========================================
    IF v_draw_count > 0 THEN
        -- Victim is the next player (before skip)
        v_victim_id := v_room.player_order[calc_next_turn(v_ps.current_turn_index, v_new_direction, v_count, false) + 1];
        
        IF v_victim_id IS NOT NULL THEN
            -- Re-fetch hidden state
            SELECT * INTO v_hs FROM uno_hidden_states WHERE room_id = p_room_id;
            v_victim_hand := v_hs.player_hands->v_victim_id::TEXT;
            IF v_victim_hand IS NULL THEN v_victim_hand := '[]'::jsonb; END IF;
            
            -- Give victim cards from deck
            FOR i IN 1..v_draw_count LOOP
                -- Reshuffle if deck empty
                IF v_hs.deck IS NULL OR jsonb_array_length(v_hs.deck) = 0 THEN
                    UPDATE uno_hidden_states SET deck = shuffle_jsonb_array(generate_uno_deck()) WHERE room_id = p_room_id;
                    SELECT * INTO v_hs FROM uno_hidden_states WHERE room_id = p_room_id;
                END IF;
                
                IF jsonb_array_length(v_hs.deck) > 0 THEN
                    v_deck_card := v_hs.deck->0;
                    v_victim_hand := v_victim_hand || jsonb_build_array(v_deck_card);
                    UPDATE uno_hidden_states SET deck = deck - 0, player_hands = jsonb_set(player_hands, ARRAY[v_victim_id::TEXT], v_victim_hand) WHERE room_id = p_room_id;
                    SELECT * INTO v_hs FROM uno_hidden_states WHERE room_id = p_room_id;
                END IF;
            END LOOP;
            
            -- Update victim's hand count
            UPDATE uno_players SET hand_count = jsonb_array_length(v_victim_hand) WHERE room_id = p_room_id AND user_id = v_victim_id;
        END IF;
    END IF;
    
    -- ========================================
    -- CALCULATE NEXT TURN
    -- ========================================
    v_next_turn := calc_next_turn(v_ps.current_turn_index, v_new_direction, v_count, v_skip);
    
    -- ========================================
    -- UPDATE PUBLIC STATE
    -- ========================================
    UPDATE uno_public_states SET
        top_card = v_card,
        current_color = COALESCE(p_wild_color, v_card->>'color'),
        current_turn_index = v_next_turn,
        direction = v_new_direction,
        turn_started_at = NOW(),
        last_event = 'card_played',
        last_event_user_id = p_user_id,
        updated_at = NOW()
    WHERE room_id = p_room_id;
    
    -- ========================================
    -- CHECK WIN CONDITION
    -- ========================================
    IF v_remaining = 0 THEN
        DECLARE
            v_winner_name TEXT;
        BEGIN
            SELECT username INTO v_winner_name FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
            
            UPDATE public.users SET cash = cash + v_room.pot_amount, updated_at = NOW() WHERE id = p_user_id RETURNING cash INTO v_winner_cash;
            INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
            VALUES (p_user_id, 'win', v_room.pot_amount, v_winner_cash, 'UNO Win', jsonb_build_object('game', 'uno', 'room_id', p_room_id));
            
            UPDATE uno_public_states SET status = 'finished', winner_id = p_user_id, winner_username = v_winner_name, last_event = 'game_over', updated_at = NOW() WHERE room_id = p_room_id;
            UPDATE uno_rooms SET status = 'finished' WHERE id = p_room_id;
            
            RETURN jsonb_build_object('success', true, 'gameOver', true, 'winner', v_winner_name, 'winAmount', v_room.pot_amount, 'newBalance', v_winner_cash);
        END;
    END IF;
    
    RETURN jsonb_build_object('success', true, 'cardPlayed', v_card, 'remainingCards', v_remaining, 'nextTurn', v_next_turn);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Draw Card
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_draw_card(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_ps RECORD;
    v_hs RECORD;
    v_card JSONB;
    v_my_hand JSONB;
    v_current_player UUID;
    v_next_turn INTEGER;
    v_count INTEGER;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    
    SELECT * INTO v_ps FROM uno_public_states WHERE room_id = p_room_id FOR UPDATE;
    IF v_ps.status != 'playing' THEN RETURN jsonb_build_object('success', false, 'error', 'Game not in progress'); END IF;
    
    v_current_player := v_room.player_order[v_ps.current_turn_index + 1];
    IF v_current_player != p_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Not your turn'); END IF;
    
    SELECT * INTO v_hs FROM uno_hidden_states WHERE room_id = p_room_id FOR UPDATE;
    
    -- Reshuffle if empty
    IF jsonb_array_length(v_hs.deck) = 0 THEN
        UPDATE uno_hidden_states SET deck = shuffle_jsonb_array(generate_uno_deck()) WHERE room_id = p_room_id;
        SELECT * INTO v_hs FROM uno_hidden_states WHERE room_id = p_room_id;
    END IF;
    
    -- Draw card
    v_card := v_hs.deck->0;
    v_my_hand := COALESCE(v_hs.player_hands->p_user_id::TEXT, '[]'::jsonb);
    v_my_hand := v_my_hand || jsonb_build_array(v_card);
    
    UPDATE uno_hidden_states SET deck = deck - 0, player_hands = jsonb_set(player_hands, ARRAY[p_user_id::TEXT], v_my_hand) WHERE room_id = p_room_id;
    UPDATE uno_players SET hand_count = jsonb_array_length(v_my_hand), has_called_uno = false WHERE room_id = p_room_id AND user_id = p_user_id;
    
    -- Advance turn
    SELECT COUNT(*) INTO v_count FROM uno_players WHERE room_id = p_room_id;
    v_next_turn := calc_next_turn(v_ps.current_turn_index, v_ps.direction, v_count, false);
    
    UPDATE uno_public_states SET current_turn_index = v_next_turn, turn_started_at = NOW(), last_event = 'card_drawn', last_event_user_id = p_user_id, updated_at = NOW() WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'drawnCard', v_card, 'nextTurn', v_next_turn);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Toggle Ready
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_toggle_ready(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_ready BOOLEAN;
BEGIN
    UPDATE uno_players SET is_ready = NOT is_ready WHERE room_id = p_room_id AND user_id = p_user_id RETURNING is_ready INTO v_ready;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Not in room'); END IF;
    
    UPDATE uno_public_states SET last_event = 'player_ready', last_event_user_id = p_user_id, updated_at = NOW() WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'isReady', v_ready);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Call UNO
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_call_uno(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_hand JSONB;
BEGIN
    SELECT player_hands->p_user_id::TEXT INTO v_hand FROM uno_hidden_states WHERE room_id = p_room_id;
    IF v_hand IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not in room'); END IF;
    IF jsonb_array_length(v_hand) > 2 THEN RETURN jsonb_build_object('success', false, 'error', 'Can only call UNO with 1-2 cards'); END IF;
    
    UPDATE uno_players SET has_called_uno = true WHERE room_id = p_room_id AND user_id = p_user_id;
    UPDATE uno_public_states SET last_event = 'uno_called', last_event_user_id = p_user_id, updated_at = NOW() WHERE room_id = p_room_id;
    
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Get Rooms
-- ========================================
CREATE OR REPLACE FUNCTION fn_get_uno_rooms()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_rooms JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(room_data), '[]'::jsonb) INTO v_rooms FROM (
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
-- GRANTS
-- ========================================
GRANT EXECUTE ON FUNCTION generate_uno_deck() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION shuffle_jsonb_array(JSONB) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION calc_next_turn(INTEGER, INTEGER, INTEGER, BOOLEAN) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_get_my_hand(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_create_uno_room(UUID, NUMERIC, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_join_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_leave_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_delete_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_start_uno_game(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_play_card(UUID, UUID, INTEGER, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_draw_card(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_toggle_ready(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_call_uno(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_get_uno_rooms() TO authenticated, anon;
