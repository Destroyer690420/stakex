-- ========================================
-- UNO GAME - COMPLETE REBUILD
-- Single Table, High-Speed Sync
-- ========================================

-- Drop old tables if they exist
DROP TABLE IF EXISTS uno_players CASCADE;
DROP TABLE IF EXISTS uno_hidden_states CASCADE;
DROP TABLE IF EXISTS uno_public_states CASCADE;
DROP TABLE IF EXISTS uno_rooms CASCADE;

-- Drop all existing functions to prevent signature conflicts
DROP FUNCTION IF EXISTS fn_create_uno_room(uuid, numeric, integer);
DROP FUNCTION IF EXISTS fn_join_uno_room(uuid, uuid);
DROP FUNCTION IF EXISTS fn_uno_toggle_ready(uuid, uuid);
DROP FUNCTION IF EXISTS fn_start_uno(uuid, uuid);
DROP FUNCTION IF EXISTS fn_start_uno_game(uuid, uuid); -- Legacy name
DROP FUNCTION IF EXISTS fn_play_card(uuid, uuid, integer, text);
DROP FUNCTION IF EXISTS fn_uno_play_card(uuid, uuid, integer, text); -- Legacy name
DROP FUNCTION IF EXISTS fn_draw_card(uuid, uuid);
DROP FUNCTION IF EXISTS fn_uno_draw_card(uuid, uuid); -- Legacy name
DROP FUNCTION IF EXISTS fn_leave_uno_room(uuid, uuid);
DROP FUNCTION IF EXISTS fn_delete_uno_room(uuid, uuid);
DROP FUNCTION IF EXISTS fn_get_uno_rooms();
DROP FUNCTION IF EXISTS fn_uno_call_uno(uuid, uuid); -- Legacy name
DROP FUNCTION IF EXISTS generate_uno_deck();
DROP FUNCTION IF EXISTS shuffle_deck(jsonb);

-- ========================================
-- UNIFIED TABLE: uno_rooms
-- All game state in one place
-- ========================================
CREATE TABLE uno_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES public.users(id),
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
    bet_amount NUMERIC DEFAULT 0,
    pot_amount NUMERIC DEFAULT 0,
    max_players INTEGER DEFAULT 4,
    
    -- Game state (JSONB for flexibility)
    deck JSONB DEFAULT '[]'::jsonb,
    discard_pile JSONB DEFAULT '[]'::jsonb,
    current_color TEXT DEFAULT NULL,
    
    -- Players array: [{user_id, username, seat_index, hand: [], is_ready, has_paid}]
    players JSONB DEFAULT '[]'::jsonb,
    
    -- Turn management
    current_turn_index INTEGER DEFAULT 0,
    direction INTEGER DEFAULT 1, -- 1 = clockwise, -1 = counter-clockwise
    turn_started_at TIMESTAMPTZ DEFAULT NULL,
    
    -- Winner info
    winner_id UUID DEFAULT NULL,
    winner_username TEXT DEFAULT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime for the entire table
ALTER PUBLICATION supabase_realtime ADD TABLE uno_rooms;

-- ========================================
-- HELPER: Generate UNO Deck
-- ========================================
CREATE OR REPLACE FUNCTION generate_uno_deck()
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
    v_deck JSONB := '[]'::jsonb;
    v_colors TEXT[] := ARRAY['red', 'blue', 'green', 'yellow'];
    v_color TEXT;
    v_id INTEGER := 1;
BEGIN
    FOREACH v_color IN ARRAY v_colors LOOP
        -- One 0 per color
        v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', v_color, 'value', '0', 'type', 'number'));
        v_id := v_id + 1;
        
        -- Two of each 1-9
        FOR i IN 1..9 LOOP
            FOR j IN 1..2 LOOP
                v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', v_color, 'value', i::TEXT, 'type', 'number'));
                v_id := v_id + 1;
            END LOOP;
        END LOOP;
        
        -- Two Skip, Reverse, +2 per color
        FOR j IN 1..2 LOOP
            v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', v_color, 'value', 'skip', 'type', 'action'));
            v_id := v_id + 1;
            v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', v_color, 'value', 'reverse', 'type', 'action'));
            v_id := v_id + 1;
            v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', v_color, 'value', '+2', 'type', 'action'));
            v_id := v_id + 1;
        END LOOP;
    END LOOP;
    
    -- 4 Wild and 4 +4
    FOR j IN 1..4 LOOP
        v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', null, 'value', 'wild', 'type', 'wild'));
        v_id := v_id + 1;
        v_deck := v_deck || jsonb_build_array(jsonb_build_object('id', v_id, 'color', null, 'value', '+4', 'type', 'wild'));
        v_id := v_id + 1;
    END LOOP;
    
    RETURN v_deck;
END;
$$;

-- ========================================
-- HELPER: Shuffle Deck
-- ========================================
CREATE OR REPLACE FUNCTION shuffle_deck(p_deck JSONB)
RETURNS JSONB
LANGUAGE plpgsql AS $$
BEGIN
    RETURN (SELECT jsonb_agg(elem ORDER BY random()) FROM jsonb_array_elements(p_deck) AS elem);
END;
$$;

-- ========================================
-- RPC: Create Room
-- ========================================
CREATE OR REPLACE FUNCTION fn_create_uno_room(p_user_id UUID, p_bet_amount NUMERIC, p_max_players INTEGER DEFAULT 4)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user RECORD;
    v_room_id UUID;
    v_player JSONB;
BEGIN
    -- Get user
    SELECT id, username, cash INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'User not found'); END IF;
    IF v_user.cash < p_bet_amount THEN RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance'); END IF;
    
    -- Deduct bet
    UPDATE public.users SET cash = cash - p_bet_amount WHERE id = p_user_id;
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
    VALUES (p_user_id, 'bet', p_bet_amount, v_user.cash - p_bet_amount, 'UNO Room Entry');
    
    -- Create player object
    v_player := jsonb_build_object(
        'user_id', p_user_id,
        'username', v_user.username,
        'seat_index', 0,
        'hand', '[]'::jsonb,
        'is_ready', true,
        'has_paid', true
    );
    
    -- Create room
    INSERT INTO uno_rooms (host_id, bet_amount, pot_amount, max_players, players)
    VALUES (p_user_id, p_bet_amount, p_bet_amount, LEAST(4, GREATEST(2, p_max_players)), jsonb_build_array(v_player))
    RETURNING id INTO v_room_id;
    
    RETURN jsonb_build_object('success', true, 'roomId', v_room_id);
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
    v_room RECORD;
    v_user RECORD;
    v_player_count INTEGER;
    v_new_player JSONB;
    v_existing JSONB;
BEGIN
    -- Lock room
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.status != 'waiting' THEN RETURN jsonb_build_object('success', false, 'error', 'Game already started'); END IF;
    
    -- Check if already in room
    SELECT elem INTO v_existing FROM jsonb_array_elements(v_room.players) AS elem WHERE (elem->>'user_id')::UUID = p_user_id;
    IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('success', true, 'alreadyInRoom', true); END IF;
    
    -- Check room full
    v_player_count := jsonb_array_length(v_room.players);
    IF v_player_count >= v_room.max_players THEN RETURN jsonb_build_object('success', false, 'error', 'Room is full'); END IF;
    
    -- Get user and deduct bet
    SELECT id, username, cash INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
    IF v_user.cash < v_room.bet_amount THEN RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance'); END IF;
    
    UPDATE public.users SET cash = cash - v_room.bet_amount WHERE id = p_user_id;
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
    VALUES (p_user_id, 'bet', v_room.bet_amount, v_user.cash - v_room.bet_amount, 'UNO Room Entry');
    
    -- Create player object
    v_new_player := jsonb_build_object(
        'user_id', p_user_id,
        'username', v_user.username,
        'seat_index', v_player_count,
        'hand', '[]'::jsonb,
        'is_ready', false,
        'has_paid', true
    );
    
    -- Add to room
    UPDATE uno_rooms SET 
        players = players || jsonb_build_array(v_new_player),
        pot_amount = pot_amount + v_room.bet_amount,
        updated_at = NOW()
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'seatIndex', v_player_count);
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
    v_room RECORD;
    v_players JSONB;
    v_idx INTEGER := 0;
    v_elem JSONB;
    v_is_ready BOOLEAN;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    
    v_players := '[]'::jsonb;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_room.players) LOOP
        IF (v_elem->>'user_id')::UUID = p_user_id THEN
            v_is_ready := NOT (v_elem->>'is_ready')::BOOLEAN;
            v_elem := jsonb_set(v_elem, '{is_ready}', to_jsonb(v_is_ready));
        END IF;
        v_players := v_players || jsonb_build_array(v_elem);
    END LOOP;
    
    UPDATE uno_rooms SET players = v_players, updated_at = NOW() WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'isReady', v_is_ready);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Start Game
-- ========================================
CREATE OR REPLACE FUNCTION fn_start_uno(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_deck JSONB;
    v_players JSONB;
    v_player JSONB;
    v_hand JSONB;
    v_card JSONB;
    v_first_card JSONB;
    v_player_count INTEGER;
    i INTEGER;
    j INTEGER;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.host_id != p_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Only host can start'); END IF;
    IF v_room.status != 'waiting' THEN RETURN jsonb_build_object('success', false, 'error', 'Game already started'); END IF;
    
    v_player_count := jsonb_array_length(v_room.players);
    IF v_player_count < 2 THEN RETURN jsonb_build_object('success', false, 'error', 'Need at least 2 players'); END IF;
    
    -- Generate and shuffle deck
    v_deck := shuffle_deck(generate_uno_deck());
    
    -- Deal 7 cards to each player
    v_players := '[]'::jsonb;
    FOR i IN 0..v_player_count-1 LOOP
        v_player := v_room.players->i;
        v_hand := '[]'::jsonb;
        
        FOR j IN 1..7 LOOP
            v_card := v_deck->0;
            v_deck := v_deck - 0;
            v_hand := v_hand || jsonb_build_array(v_card);
        END LOOP;
        
        v_player := jsonb_set(v_player, '{hand}', v_hand);
        v_players := v_players || jsonb_build_array(v_player);
    END LOOP;
    
    -- Find first number card for discard pile
    LOOP
        v_first_card := v_deck->0;
        v_deck := v_deck - 0;
        IF (v_first_card->>'type') = 'number' THEN EXIT; END IF;
        v_deck := v_deck || jsonb_build_array(v_first_card);
    END LOOP;
    
    -- Update room
    UPDATE uno_rooms SET
        status = 'playing',
        deck = v_deck,
        discard_pile = jsonb_build_array(v_first_card),
        current_color = v_first_card->>'color',
        players = v_players,
        current_turn_index = 0,
        direction = 1,
        turn_started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Play Card
-- ========================================
CREATE OR REPLACE FUNCTION fn_play_card(p_user_id UUID, p_room_id UUID, p_card_index INTEGER, p_wild_color TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_player JSONB;
    v_player_idx INTEGER;
    v_card JSONB;
    v_top_card JSONB;
    v_new_hand JSONB;
    v_players JSONB;
    v_player_count INTEGER;
    v_next_turn INTEGER;
    v_new_direction INTEGER;
    v_skip BOOLEAN := false;
    v_draw_count INTEGER := 0;
    v_victim_idx INTEGER;
    v_victim JSONB;
    v_victim_hand JSONB;
    v_deck_card JSONB;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.status != 'playing' THEN RETURN jsonb_build_object('success', false, 'error', 'Game not in progress'); END IF;
    
    v_player_count := jsonb_array_length(v_room.players);
    
    -- Find player and verify turn
    v_player_idx := -1;
    FOR i IN 0..v_player_count-1 LOOP
        IF (v_room.players->i->>'user_id')::UUID = p_user_id THEN
            v_player_idx := i;
            v_player := v_room.players->i;
            EXIT;
        END IF;
    END LOOP;
    
    IF v_player_idx = -1 THEN RETURN jsonb_build_object('success', false, 'error', 'Not in game'); END IF;
    IF v_room.current_turn_index != v_player_idx THEN RETURN jsonb_build_object('success', false, 'error', 'Not your turn'); END IF;
    
    -- Get card
    v_card := v_player->'hand'->p_card_index;
    IF v_card IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Invalid card'); END IF;
    
    -- Validate card is playable
    v_top_card := v_room.discard_pile->-1;
    IF (v_card->>'type') != 'wild' THEN
        IF (v_card->>'color') != v_room.current_color AND (v_card->>'value') != (v_top_card->>'value') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Card cannot be played');
        END IF;
    ELSE
        IF p_wild_color IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Must choose color');
        END IF;
    END IF;
    
    -- Remove card from hand
    v_new_hand := '[]'::jsonb;
    FOR i IN 0..jsonb_array_length(v_player->'hand')-1 LOOP
        IF i != p_card_index THEN
            v_new_hand := v_new_hand || jsonb_build_array(v_player->'hand'->i);
        END IF;
    END LOOP;
    
    -- Handle special cards
    v_new_direction := v_room.direction;
    
    CASE v_card->>'value'
        WHEN 'reverse' THEN
            v_new_direction := v_room.direction * -1;
            IF v_player_count = 2 THEN v_skip := true; END IF;
        WHEN 'skip' THEN
            v_skip := true;
        WHEN '+2' THEN
            v_skip := true;
            v_draw_count := 2;
        WHEN '+4' THEN
            v_skip := true;
            v_draw_count := 4;
        ELSE NULL;
    END CASE;
    
    -- Calculate next turn
    v_next_turn := v_player_idx + v_new_direction;
    IF v_skip THEN v_next_turn := v_next_turn + v_new_direction; END IF;
    v_next_turn := v_next_turn % v_player_count;
    IF v_next_turn < 0 THEN v_next_turn := v_next_turn + v_player_count; END IF;
    
    -- Handle +2/+4 victim
    IF v_draw_count > 0 THEN
        v_victim_idx := (v_player_idx + v_new_direction) % v_player_count;
        IF v_victim_idx < 0 THEN v_victim_idx := v_victim_idx + v_player_count; END IF;
        
        v_victim := v_room.players->v_victim_idx;
        v_victim_hand := v_victim->'hand';
        
        FOR i IN 1..v_draw_count LOOP
            IF jsonb_array_length(v_room.deck) > 0 THEN
                v_deck_card := v_room.deck->0;
                v_room.deck := v_room.deck - 0;
                v_victim_hand := v_victim_hand || jsonb_build_array(v_deck_card);
            END IF;
        END LOOP;
        
        v_victim := jsonb_set(v_victim, '{hand}', v_victim_hand);
    END IF;
    
    -- Build new players array
    v_players := '[]'::jsonb;
    FOR i IN 0..v_player_count-1 LOOP
        IF i = v_player_idx THEN
            v_players := v_players || jsonb_build_array(jsonb_set(v_player, '{hand}', v_new_hand));
        ELSIF v_draw_count > 0 AND i = v_victim_idx THEN
            v_players := v_players || jsonb_build_array(v_victim);
        ELSE
            v_players := v_players || jsonb_build_array(v_room.players->i);
        END IF;
    END LOOP;
    
    -- Check win condition
    IF jsonb_array_length(v_new_hand) = 0 THEN
        UPDATE public.users SET cash = cash + v_room.pot_amount WHERE id = p_user_id;
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
        SELECT p_user_id, 'win', v_room.pot_amount, cash, 'UNO Win' FROM public.users WHERE id = p_user_id;
        
        UPDATE uno_rooms SET
            status = 'finished',
            players = v_players,
            discard_pile = v_room.discard_pile || jsonb_build_array(v_card),
            current_color = COALESCE(p_wild_color, v_card->>'color'),
            winner_id = p_user_id,
            winner_username = v_player->>'username',
            updated_at = NOW()
        WHERE id = p_room_id;
        
        RETURN jsonb_build_object('success', true, 'gameOver', true, 'winner', v_player->>'username');
    END IF;
    
    -- Update room state
    UPDATE uno_rooms SET
        deck = v_room.deck,
        discard_pile = v_room.discard_pile || jsonb_build_array(v_card),
        current_color = COALESCE(p_wild_color, v_card->>'color'),
        players = v_players,
        current_turn_index = v_next_turn,
        direction = v_new_direction,
        turn_started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'nextTurn', v_next_turn);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Draw Card
-- ========================================
CREATE OR REPLACE FUNCTION fn_draw_card(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_player JSONB;
    v_player_idx INTEGER;
    v_card JSONB;
    v_new_hand JSONB;
    v_players JSONB;
    v_player_count INTEGER;
    v_next_turn INTEGER;
    i INTEGER;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.status != 'playing' THEN RETURN jsonb_build_object('success', false, 'error', 'Game not in progress'); END IF;
    
    v_player_count := jsonb_array_length(v_room.players);
    
    -- Find player and verify turn
    v_player_idx := -1;
    FOR i IN 0..v_player_count-1 LOOP
        IF (v_room.players->i->>'user_id')::UUID = p_user_id THEN
            v_player_idx := i;
            v_player := v_room.players->i;
            EXIT;
        END IF;
    END LOOP;
    
    IF v_player_idx = -1 THEN RETURN jsonb_build_object('success', false, 'error', 'Not in game'); END IF;
    IF v_room.current_turn_index != v_player_idx THEN RETURN jsonb_build_object('success', false, 'error', 'Not your turn'); END IF;
    
    -- Reshuffle if deck empty
    IF jsonb_array_length(v_room.deck) = 0 THEN
        v_room.deck := shuffle_deck(generate_uno_deck());
    END IF;
    
    -- Draw card
    v_card := v_room.deck->0;
    v_room.deck := v_room.deck - 0;
    v_new_hand := v_player->'hand' || jsonb_build_array(v_card);
    
    -- Build new players array
    v_players := '[]'::jsonb;
    FOR i IN 0..v_player_count-1 LOOP
        IF i = v_player_idx THEN
            v_players := v_players || jsonb_build_array(jsonb_set(v_player, '{hand}', v_new_hand));
        ELSE
            v_players := v_players || jsonb_build_array(v_room.players->i);
        END IF;
    END LOOP;
    
    -- Advance turn
    v_next_turn := (v_player_idx + v_room.direction) % v_player_count;
    IF v_next_turn < 0 THEN v_next_turn := v_next_turn + v_player_count; END IF;
    
    -- Update room
    UPDATE uno_rooms SET
        deck = v_room.deck,
        players = v_players,
        current_turn_index = v_next_turn,
        turn_started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true, 'drawnCard', v_card, 'nextTurn', v_next_turn);
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
    v_players JSONB := '[]'::jsonb;
    v_elem JSONB;
    v_remaining INTEGER;
    v_winner_id UUID;
    v_winner_name TEXT;
    i INTEGER := 0;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    
    -- Refund if waiting
    IF v_room.status = 'waiting' THEN
        UPDATE public.users SET cash = cash + v_room.bet_amount WHERE id = p_user_id;
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
        SELECT p_user_id, 'win', v_room.bet_amount, cash, 'UNO Refund' FROM public.users WHERE id = p_user_id;
    END IF;
    
    -- Remove player and reindex
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_room.players) LOOP
        IF (v_elem->>'user_id')::UUID != p_user_id THEN
            v_elem := jsonb_set(v_elem, '{seat_index}', to_jsonb(i));
            v_players := v_players || jsonb_build_array(v_elem);
            i := i + 1;
        END IF;
    END LOOP;
    
    v_remaining := jsonb_array_length(v_players);
    
    -- Delete room if empty
    IF v_remaining = 0 THEN
        DELETE FROM uno_rooms WHERE id = p_room_id;
        RETURN jsonb_build_object('success', true, 'roomDeleted', true);
    END IF;
    
    -- Check for auto-win in playing status
    IF v_room.status = 'playing' AND v_remaining = 1 THEN
        v_winner_id := (v_players->0->>'user_id')::UUID;
        v_winner_name := v_players->0->>'username';
        
        UPDATE public.users SET cash = cash + v_room.pot_amount WHERE id = v_winner_id;
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
        SELECT v_winner_id, 'win', v_room.pot_amount, cash, 'UNO Win' FROM public.users WHERE id = v_winner_id;
        
        UPDATE uno_rooms SET
            status = 'finished',
            players = v_players,
            winner_id = v_winner_id,
            winner_username = v_winner_name,
            pot_amount = v_room.pot_amount - v_room.bet_amount,
            updated_at = NOW()
        WHERE id = p_room_id;
        
        RETURN jsonb_build_object('success', true);
    END IF;
    
    -- Update room
    UPDATE uno_rooms SET
        players = v_players,
        pot_amount = CASE WHEN v_room.status = 'waiting' THEN v_room.pot_amount - v_room.bet_amount ELSE v_room.pot_amount END,
        host_id = CASE WHEN v_room.host_id = p_user_id THEN (v_players->0->>'user_id')::UUID ELSE v_room.host_id END,
        current_turn_index = CASE WHEN v_room.current_turn_index >= v_remaining THEN 0 ELSE v_room.current_turn_index END,
        updated_at = NOW()
    WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Delete Room (Host Only)
-- ========================================
CREATE OR REPLACE FUNCTION fn_delete_uno_room(p_user_id UUID, p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_room RECORD;
    v_elem JSONB;
BEGIN
    SELECT * INTO v_room FROM uno_rooms WHERE id = p_room_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Room not found'); END IF;
    IF v_room.host_id != p_user_id THEN RETURN jsonb_build_object('success', false, 'error', 'Only host can delete'); END IF;
    IF v_room.status = 'playing' THEN RETURN jsonb_build_object('success', false, 'error', 'Cannot delete during game'); END IF;
    
    -- Refund all players
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_room.players) LOOP
        UPDATE public.users SET cash = cash + v_room.bet_amount WHERE id = (v_elem->>'user_id')::UUID;
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description)
        SELECT (v_elem->>'user_id')::UUID, 'win', v_room.bet_amount, cash, 'UNO Refund' FROM public.users WHERE id = (v_elem->>'user_id')::UUID;
    END LOOP;
    
    DELETE FROM uno_rooms WHERE id = p_room_id;
    
    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- RPC: Get Rooms (Lobby List)
-- ========================================
CREATE OR REPLACE FUNCTION fn_get_uno_rooms()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN jsonb_build_object('success', true, 'rooms', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'host_id', host_id,
            'host_username', (SELECT username FROM public.users WHERE id = host_id),
            'bet_amount', bet_amount,
            'pot_amount', pot_amount,
            'max_players', max_players,
            'player_count', jsonb_array_length(players),
            'status', status
        ) ORDER BY created_at DESC) FROM uno_rooms WHERE status = 'waiting' LIMIT 20),
        '[]'::jsonb
    ));
END;
$$;

-- ========================================
-- GRANTS
-- ========================================
GRANT ALL ON uno_rooms TO authenticated, anon;
GRANT EXECUTE ON FUNCTION generate_uno_deck() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION shuffle_deck(JSONB) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_create_uno_room(UUID, NUMERIC, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_join_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_uno_toggle_ready(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_start_uno(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_play_card(UUID, UUID, INTEGER, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_draw_card(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_leave_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_delete_uno_room(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION fn_get_uno_rooms() TO authenticated, anon;
