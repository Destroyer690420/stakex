-- ========================================
-- UNO MULTIPLAYER GAME SCHEMA FOR SUPABASE
-- Room-based, Pay-to-Enter, Winner-Takes-All
-- COMPLETE CLEAN VERSION - Run this in Supabase SQL Editor
-- ========================================

-- COMPREHENSIVE CLEANUP - Drop ALL possible function signatures
DROP FUNCTION IF EXISTS fn_create_uno_room(NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS fn_create_uno_room(NUMERIC, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS fn_create_uno_room(UUID, NUMERIC) CASCADE;
DROP FUNCTION IF EXISTS fn_create_uno_room(UUID, NUMERIC, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS fn_create_uno_room(UUID, INTEGER, NUMERIC) CASCADE;

DROP FUNCTION IF EXISTS fn_join_uno_room(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_join_uno_room(UUID, UUID) CASCADE;

DROP FUNCTION IF EXISTS fn_start_uno_game(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_start_uno_game(UUID, UUID) CASCADE;

DROP FUNCTION IF EXISTS fn_leave_uno_room(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_leave_uno_room(UUID, UUID) CASCADE;

DROP FUNCTION IF EXISTS fn_uno_play_card(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_play_card(UUID, UUID, INTEGER, TEXT) CASCADE;

DROP FUNCTION IF EXISTS fn_uno_draw_card(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_draw_card(UUID, UUID) CASCADE;

DROP FUNCTION IF EXISTS fn_uno_toggle_ready(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_toggle_ready(UUID, UUID) CASCADE;

DROP FUNCTION IF EXISTS fn_uno_call_uno(UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_uno_call_uno(UUID, UUID) CASCADE;

DROP FUNCTION IF EXISTS fn_get_uno_rooms() CASCADE;
DROP FUNCTION IF EXISTS generate_uno_deck() CASCADE;
DROP FUNCTION IF EXISTS shuffle_jsonb_array(JSONB) CASCADE;

-- Drop tables
DROP TABLE IF EXISTS uno_players CASCADE;
DROP TABLE IF EXISTS uno_rooms CASCADE;

-- ========================================
-- TABLE: uno_rooms
-- ========================================
CREATE TABLE uno_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES public.users(id),
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 10),
    pot_amount NUMERIC NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 4 CHECK (max_players >= 2 AND max_players <= 4),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
    current_turn_index INTEGER DEFAULT 0,
    direction INTEGER DEFAULT 1 CHECK (direction IN (1, -1)),
    top_card JSONB,
    current_color TEXT CHECK (current_color IN ('red', 'blue', 'green', 'yellow', NULL)),
    deck JSONB DEFAULT '[]'::jsonb,
    player_order UUID[] DEFAULT '{}',
    winner_id UUID REFERENCES public.users(id),
    winner_username TEXT,
    turn_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- TABLE: uno_players
-- ========================================
CREATE TABLE uno_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES uno_rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id),
    username TEXT NOT NULL,
    avatar_url TEXT,
    hand JSONB DEFAULT '[]'::jsonb,
    seat_index INTEGER NOT NULL,
    is_ready BOOLEAN DEFAULT FALSE,
    has_paid BOOLEAN DEFAULT FALSE,
    has_called_uno BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(room_id, user_id),
    UNIQUE(room_id, seat_index)
);

-- Create indexes
CREATE INDEX idx_uno_rooms_status ON uno_rooms(status);
CREATE INDEX idx_uno_rooms_host ON uno_rooms(host_id);
CREATE INDEX idx_uno_players_room ON uno_players(room_id);
CREATE INDEX idx_uno_players_user ON uno_players(user_id);

-- ========================================
-- HELPER: Generate UNO Deck (108 cards)
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

-- ========================================
-- HELPER: Shuffle JSONB Array
-- ========================================
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
-- RPC: Create UNO Room
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
    -- Validate user
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    -- Validate bet
    IF p_bet_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is $10');
    END IF;
    
    IF p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is $10,000');
    END IF;
    
    -- Default max players if null
    v_max_p := COALESCE(p_max_players, 4);
    IF v_max_p < 2 OR v_max_p > 4 THEN
        v_max_p := 4;
    END IF;
    
    -- Get user info and lock
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
    
    -- Deduct bet
    v_new_cash := v_current_cash - p_bet_amount;
    UPDATE public.users
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Record transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_new_cash, 'UNO Room Entry Fee (Host)',
            jsonb_build_object('game', 'uno', 'action', 'create_room'));
    
    -- Create room
    INSERT INTO uno_rooms (host_id, bet_amount, pot_amount, max_players, player_order)
    VALUES (p_user_id, p_bet_amount, p_bet_amount, v_max_p, ARRAY[p_user_id])
    RETURNING id INTO v_room_id;
    
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
-- RPC: Join UNO Room
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
        RETURN jsonb_build_object('success', false, 'error', 'Already in this room');
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
-- RPC: Leave UNO Room
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
    
    IF v_room.status = 'waiting' THEN
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
        
        IF p_user_id = v_room.host_id THEN
            SELECT COUNT(*) INTO v_remaining_count FROM uno_players WHERE room_id = p_room_id;
            IF v_remaining_count = 0 THEN
                DELETE FROM uno_rooms WHERE id = p_room_id;
            ELSE
                SELECT user_id INTO v_winner_id FROM uno_players WHERE room_id = p_room_id ORDER BY seat_index LIMIT 1;
                UPDATE uno_rooms SET host_id = v_winner_id WHERE id = p_room_id;
            END IF;
        END IF;
        
        RETURN jsonb_build_object('success', true, 'refunded', true, 'newBalance', v_new_cash);
        
    ELSIF v_room.status = 'playing' THEN
        -- Forfeit
        UPDATE uno_rooms
        SET player_order = array_remove(player_order, p_user_id),
            updated_at = NOW()
        WHERE id = p_room_id;
        
        DELETE FROM uno_players WHERE room_id = p_room_id AND user_id = p_user_id;
        
        SELECT COUNT(*) INTO v_remaining_count FROM uno_players WHERE room_id = p_room_id;
        
        IF v_remaining_count = 1 THEN
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
            
            UPDATE uno_rooms
            SET status = 'finished',
                winner_id = v_winner_id,
                winner_username = v_winner_username,
                updated_at = NOW()
            WHERE id = p_room_id;
        ELSIF v_remaining_count = 0 THEN
            UPDATE uno_rooms SET status = 'finished', updated_at = NOW() WHERE id = p_room_id;
        ELSE
            IF v_room.current_turn_index >= v_remaining_count THEN
                UPDATE uno_rooms
                SET current_turn_index = 0,
                    turn_started_at = NOW()
                WHERE id = p_room_id;
            END IF;
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
-- RPC: Start UNO Game
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
    
    IF v_room.status != 'waiting' THEN
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
        
        UPDATE uno_players SET hand = v_hand WHERE id = v_player.id;
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
    
    -- Update room
    UPDATE uno_rooms
    SET status = 'playing',
        deck = v_deck,
        top_card = v_top_card,
        current_color = v_top_card->>'color',
        current_turn_index = 0,
        direction = 1,
        turn_started_at = NOW(),
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
-- RPC: Play Card
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
    v_player RECORD;
    v_card JSONB;
    v_played_card JSONB;
    v_drawn_card JSONB;
    v_current_deck JSONB;
    v_current_player_id UUID;
    v_next_turn INTEGER;
    v_player_count INTEGER;
    v_remaining_cards INTEGER;
    v_winner_id UUID;
    v_winner_username TEXT;
    v_new_cash NUMERIC;
    v_next_player RECORD;
    v_draw_cards INTEGER := 0;
    v_skip_next BOOLEAN := false;
    v_skip_target_turn INTEGER;
    v_skip_target_user_id UUID;
    i INTEGER;
    -- Variables for +2/+4 draw logic
    v_victim_user_id UUID;
    v_victim_index INTEGER;
    v_deck_card JSONB;
    v_fresh_deck JSONB;
    v_arr_len INTEGER;
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
    
    IF v_room.status != 'playing' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not in progress');
    END IF;
    
    v_current_player_id := v_room.player_order[v_room.current_turn_index + 1];
    IF v_current_player_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not your turn');
    END IF;
    
    SELECT * INTO v_player
    FROM uno_players
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    v_card := v_player.hand->p_card_index;
    v_played_card := v_card;  -- Preserve the played card
    IF v_card IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid card index');
    END IF;
    
    -- Validate card
    IF (v_card->>'type') != 'wild' THEN
        IF (v_card->>'color') != v_room.current_color AND (v_card->>'value') != (v_room.top_card->>'value') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Card cannot be played');
        END IF;
    END IF;
    
    IF (v_card->>'type') = 'wild' AND p_wild_color IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Must select color for wild card');
    END IF;
    
    -- Remove card from hand
    UPDATE uno_players
    SET hand = hand - p_card_index,
        has_called_uno = false
    WHERE room_id = p_room_id AND user_id = p_user_id
    RETURNING jsonb_array_length(hand) INTO v_remaining_cards;
    
    SELECT COUNT(*) INTO v_player_count FROM uno_players WHERE room_id = p_room_id;
    
    -- Handle special cards
    CASE v_card->>'value'
        WHEN 'reverse' THEN
            UPDATE uno_rooms SET direction = direction * -1 WHERE id = p_room_id;
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
    SELECT direction INTO v_room.direction FROM uno_rooms WHERE id = p_room_id;
    v_next_turn := v_room.current_turn_index + v_room.direction;
    
    IF v_skip_next THEN
        v_next_turn := v_next_turn + v_room.direction;
    END IF;
    
    -- Wrap around
    IF v_next_turn < 0 THEN
        v_next_turn := v_player_count + v_next_turn;
    END IF;
    v_next_turn := v_next_turn % v_player_count;
    
    -- =============================================
    -- +2 / +4 CARD: Make next player draw cards
    -- =============================================
    IF v_draw_cards > 0 THEN
        -- Get array length
        v_arr_len := array_length(v_room.player_order, 1);
        
        -- Calculate victim index: next player after current (the one being skipped)
        -- current_turn_index is 0-based, player_order is 1-indexed
        v_victim_index := v_room.current_turn_index + v_room.direction;
        
        -- Wrap around for negative values
        IF v_victim_index < 0 THEN
            v_victim_index := v_arr_len + v_victim_index;
        END IF;
        
        -- Wrap around for values >= array length
        v_victim_index := v_victim_index % v_arr_len;
        
        -- Get victim's user_id from player_order (convert to 1-indexed)
        v_victim_user_id := v_room.player_order[v_victim_index + 1];
        
        -- Only proceed if we have a valid victim
        IF v_victim_user_id IS NOT NULL THEN
            -- Draw cards one at a time
            FOR i IN 1..v_draw_cards LOOP
                -- Get current deck state
                SELECT deck INTO v_fresh_deck 
                FROM uno_rooms 
                WHERE id = p_room_id;
                
                -- Check deck has cards
                IF v_fresh_deck IS NOT NULL AND jsonb_array_length(v_fresh_deck) > 0 THEN
                    -- Get top card from deck
                    v_deck_card := v_fresh_deck->0;
                    
                    -- Add to victim's hand
                    UPDATE uno_players
                    SET hand = hand || jsonb_build_array(v_deck_card)
                    WHERE room_id = p_room_id 
                      AND user_id = v_victim_user_id;
                    
                    -- Remove from deck
                    UPDATE uno_rooms
                    SET deck = deck - 0
                    WHERE id = p_room_id;
                END IF;
            END LOOP;
        END IF;
    END IF;
    
    -- Update room state
    UPDATE uno_rooms
    SET top_card = v_played_card,
        current_color = COALESCE(p_wild_color, v_played_card->>'color'),
        current_turn_index = v_next_turn,
        turn_started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_room_id;
    
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
        
        UPDATE uno_rooms
        SET status = 'finished',
            winner_id = v_winner_id,
            winner_username = v_winner_username,
            updated_at = NOW()
        WHERE id = p_room_id;
        
        -- Update game stats (if function exists)
        BEGIN
            PERFORM update_game_stats(v_winner_id, true);
        EXCEPTION WHEN OTHERS THEN
            -- Ignore if function doesn't exist
            NULL;
        END;
        
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
-- RPC: Draw Card
-- ========================================
CREATE OR REPLACE FUNCTION fn_uno_draw_card(
    p_user_id UUID,
    p_room_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_current_player_id UUID;
    v_card JSONB;
    v_next_turn INTEGER;
    v_player_count INTEGER;
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
    
    IF v_room.status != 'playing' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not in progress');
    END IF;
    
    v_current_player_id := v_room.player_order[v_room.current_turn_index + 1];
    IF v_current_player_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not your turn');
    END IF;
    
    IF jsonb_array_length(v_room.deck) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Deck is empty');
    END IF;
    
    v_card := v_room.deck->0;
    
    UPDATE uno_players
    SET hand = hand || jsonb_build_array(v_card),
        has_called_uno = false
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    UPDATE uno_rooms
    SET deck = deck - 0
    WHERE id = p_room_id;
    
    -- Move to next turn
    SELECT COUNT(*) INTO v_player_count FROM uno_players WHERE room_id = p_room_id;
    v_next_turn := v_room.current_turn_index + v_room.direction;
    
    IF v_next_turn < 0 THEN
        v_next_turn := v_player_count + v_next_turn;
    END IF;
    v_next_turn := v_next_turn % v_player_count;
    
    UPDATE uno_rooms
    SET current_turn_index = v_next_turn,
        turn_started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_room_id;
    
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
    v_hand_count INTEGER;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User ID required');
    END IF;
    
    SELECT jsonb_array_length(hand) INTO v_hand_count
    FROM uno_players
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
    IF v_hand_count IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not in this room');
    END IF;
    
    IF v_hand_count > 2 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Can only call UNO with 1-2 cards');
    END IF;
    
    UPDATE uno_players
    SET has_called_uno = true
    WHERE room_id = p_room_id AND user_id = p_user_id;
    
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
            'player_count', (SELECT COUNT(*) FROM uno_players WHERE room_id = r.id),
            'status', r.status,
            'created_at', r.created_at
        ) as room_data
        FROM uno_rooms r
        WHERE r.status = 'waiting'
        ORDER BY r.created_at DESC
        LIMIT 20
    ) sub;
    
    RETURN jsonb_build_object('success', true, 'rooms', v_rooms);
END;
$$;

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================
ALTER TABLE uno_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE uno_players ENABLE ROW LEVEL SECURITY;

-- Allow all operations (functions handle auth)
DROP POLICY IF EXISTS "Allow all on uno_rooms" ON uno_rooms;
DROP POLICY IF EXISTS "Allow all on uno_players" ON uno_players;

CREATE POLICY "Allow all on uno_rooms" ON uno_rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on uno_players" ON uno_players FOR ALL USING (true) WITH CHECK (true);

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION fn_create_uno_room(UUID, NUMERIC, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_join_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_start_uno_game(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_leave_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_play_card(UUID, UUID, INTEGER, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_draw_card(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_toggle_ready(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_call_uno(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_get_uno_rooms() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION generate_uno_deck() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION shuffle_jsonb_array(JSONB) TO authenticated, anon;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON uno_rooms TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON uno_players TO authenticated, anon;

-- ========================================
-- ENABLE REALTIME
-- ========================================
-- Enable realtime for uno_rooms
ALTER PUBLICATION supabase_realtime ADD TABLE uno_rooms;

-- Enable realtime for uno_players
ALTER PUBLICATION supabase_realtime ADD TABLE uno_players;
