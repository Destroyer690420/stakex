-- ========================================
-- BACCARAT GAME SCHEMA FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS fn_baccarat_settle_sp(uuid, numeric, numeric, numeric, text, jsonb);

-- ========================================
-- SINGLEPLAYER LAZY-SYNC RPC
-- Called ONCE after round completes locally
-- ========================================

CREATE OR REPLACE FUNCTION fn_baccarat_settle_sp(
    p_user_id UUID,
    p_total_bet NUMERIC,
    p_total_payout NUMERIC,
    p_total_profit NUMERIC,
    p_winner TEXT,
    p_game_data JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_transaction_type TEXT;
    v_description TEXT;
BEGIN
    -- Validate inputs
    IF p_total_bet < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid bet amount');
    END IF;

    IF p_winner NOT IN ('player', 'banker', 'tie') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid winner');
    END IF;

    -- Lock user row and get current cash
    SELECT cash INTO v_current_cash
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    -- The client already calculated the result
    -- We just need to apply the net change to balance
    -- profit can be negative (loss), zero (push), or positive (win)
    
    v_new_cash := v_current_cash + p_total_profit;
    
    -- Ensure balance doesn't go negative (shouldn't happen if client validated)
    IF v_new_cash < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;

    -- Update user balance
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Determine transaction type and description
    IF p_total_profit > 0 THEN
        v_transaction_type := 'win';
        v_description := format('Baccarat win - %s won, profit $%s', 
                               UPPER(p_winner), p_total_profit);
    ELSIF p_total_profit < 0 THEN
        v_transaction_type := 'loss';
        v_description := format('Baccarat loss - %s won, lost $%s', 
                               UPPER(p_winner), ABS(p_total_profit));
    ELSE
        -- Push (tie with player/banker bet)
        v_transaction_type := 'bet';
        v_description := format('Baccarat push - TIE, bets returned');
    END IF;

    -- Record transaction (only if there was actual money movement)
    IF p_total_profit != 0 THEN
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (
            p_user_id, 
            v_transaction_type, 
            ABS(p_total_profit), 
            v_new_cash,
            v_description,
            jsonb_build_object(
                'game', 'baccarat_sp',
                'winner', p_winner,
                'total_bet', p_total_bet,
                'total_payout', p_total_payout,
                'profit', p_total_profit,
                'bets', p_game_data->'bets',
                'player_score', p_game_data->'playerScore',
                'banker_score', p_game_data->'bankerScore'
            )
        );

        -- Update game stats
        PERFORM update_game_stats(p_user_id, p_total_profit > 0);
    END IF;

    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'newBalance', v_new_cash,
        'profit', p_total_profit,
        'transactionType', v_transaction_type
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION fn_baccarat_settle_sp(uuid, numeric, numeric, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_baccarat_settle_sp(uuid, numeric, numeric, numeric, text, jsonb) TO service_role;

-- ========================================
-- MULTIPLAYER ROOM MANAGEMENT (Optional)
-- Only create if multiplayer is needed
-- ========================================

-- Baccarat Rooms Table
CREATE TABLE IF NOT EXISTS public.baccarat_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code TEXT UNIQUE NOT NULL,
    host_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    min_bet NUMERIC DEFAULT 10 NOT NULL,
    max_bet NUMERIC DEFAULT 1000 NOT NULL,
    status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'betting', 'dealing', 'result', 'closed')),
    current_phase TEXT DEFAULT 'betting',
    player_cards JSONB DEFAULT '[]'::jsonb,
    banker_cards JSONB DEFAULT '[]'::jsonb,
    player_score INTEGER DEFAULT 0,
    banker_score INTEGER DEFAULT 0,
    winner TEXT DEFAULT NULL,
    participants JSONB DEFAULT '[]'::jsonb,
    bets JSONB DEFAULT '{}'::jsonb,
    round_number INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.baccarat_rooms ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view baccarat rooms" ON public.baccarat_rooms
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create rooms" ON public.baccarat_rooms
    FOR INSERT WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Host can update their room" ON public.baccarat_rooms
    FOR UPDATE USING (auth.uid() = host_id);

CREATE POLICY "Host can delete their room" ON public.baccarat_rooms
    FOR DELETE USING (auth.uid() = host_id);

-- Index for room lookup
CREATE INDEX IF NOT EXISTS idx_baccarat_rooms_code ON public.baccarat_rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_baccarat_rooms_status ON public.baccarat_rooms(status);

-- Enable Realtime for multiplayer sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.baccarat_rooms;

-- ========================================
-- MULTIPLAYER RPC FUNCTIONS
-- ========================================

-- Create a multiplayer room
CREATE OR REPLACE FUNCTION fn_baccarat_create_room(
    p_user_id UUID,
    p_min_bet NUMERIC DEFAULT 10,
    p_max_bet NUMERIC DEFAULT 1000
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room_code TEXT;
    v_room_id UUID;
    v_username TEXT;
BEGIN
    -- Get username
    SELECT username INTO v_username FROM public.users WHERE id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    -- Generate unique room code
    v_room_code := UPPER(SUBSTR(MD5(RANDOM()::TEXT), 1, 6));
    
    -- Create room
    INSERT INTO public.baccarat_rooms (room_code, host_id, min_bet, max_bet, participants)
    VALUES (
        v_room_code, 
        p_user_id, 
        p_min_bet, 
        p_max_bet,
        jsonb_build_array(jsonb_build_object('id', p_user_id, 'username', v_username))
    )
    RETURNING id INTO v_room_id;

    RETURN jsonb_build_object(
        'success', true,
        'roomId', v_room_id,
        'roomCode', v_room_code
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Join a multiplayer room
CREATE OR REPLACE FUNCTION fn_baccarat_join_room(
    p_user_id UUID,
    p_room_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_username TEXT;
    v_participants JSONB;
BEGIN
    -- Get username
    SELECT username INTO v_username FROM public.users WHERE id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    -- Get and lock room
    SELECT * INTO v_room
    FROM public.baccarat_rooms
    WHERE room_code = UPPER(p_room_code)
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room not found');
    END IF;

    IF v_room.status = 'closed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Room is closed');
    END IF;

    -- Check if already in room
    IF v_room.participants @> jsonb_build_array(jsonb_build_object('id', p_user_id)) THEN
        RETURN jsonb_build_object(
            'success', true,
            'roomId', v_room.id,
            'roomCode', v_room.room_code,
            'message', 'Already in room'
        );
    END IF;

    -- Add participant
    v_participants := v_room.participants || jsonb_build_array(
        jsonb_build_object('id', p_user_id, 'username', v_username)
    );

    UPDATE public.baccarat_rooms
    SET participants = v_participants, updated_at = NOW()
    WHERE id = v_room.id;

    RETURN jsonb_build_object(
        'success', true,
        'roomId', v_room.id,
        'roomCode', v_room.room_code
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant permissions for multiplayer functions
GRANT EXECUTE ON FUNCTION fn_baccarat_create_room(uuid, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_baccarat_join_room(uuid, text) TO authenticated;
