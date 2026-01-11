-- ========================================
-- MINES GAME SCHEMA FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop existing functions if they exist (to avoid parameter name conflicts)
DROP FUNCTION IF EXISTS mines_reveal(uuid, uuid, integer);
DROP FUNCTION IF EXISTS mines_start(uuid, numeric, integer);
DROP FUNCTION IF EXISTS mines_cashout(uuid, uuid);
DROP FUNCTION IF EXISTS mines_get_active(uuid);
DROP FUNCTION IF EXISTS get_mines_multiplier(integer, integer);

-- Mines Games Table (stores all game sessions)
CREATE TABLE IF NOT EXISTS public.mines_games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    bet_amount NUMERIC NOT NULL CHECK (bet_amount >= 10),
    mines_count INTEGER NOT NULL CHECK (mines_count >= 1 AND mines_count <= 24),
    mine_positions JSONB NOT NULL, -- Array of mine indices (0-24)
    revealed_tiles JSONB DEFAULT '[]'::jsonb, -- Array of revealed tile indices
    current_multiplier NUMERIC DEFAULT 1.0 NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_mines_games_user_id ON public.mines_games(user_id);
CREATE INDEX IF NOT EXISTS idx_mines_games_status ON public.mines_games(status);
CREATE INDEX IF NOT EXISTS idx_mines_games_created_at ON public.mines_games(created_at DESC);

-- Enable RLS
ALTER TABLE public.mines_games ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own mines games" ON public.mines_games
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert mines games" ON public.mines_games
    FOR INSERT WITH CHECK (true);

CREATE POLICY "System can update mines games" ON public.mines_games
    FOR UPDATE USING (true);

-- ========================================
-- MULTIPLIER CALCULATION FUNCTION
-- Returns multiplier based on mines count and revealed tiles
-- Formula: (25! / (25 - revealed)!) / ((25 - mines)! / (25 - mines - revealed)!) * (1 - houseEdge)
-- ========================================

CREATE OR REPLACE FUNCTION get_mines_multiplier(
    p_mines_count INTEGER,
    p_revealed_count INTEGER
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_total_tiles INTEGER := 25;
    v_safe_tiles INTEGER;
    v_multiplier NUMERIC;
    v_house_edge NUMERIC := 0.03; -- 3% house edge
    v_numerator NUMERIC := 1;
    v_denominator NUMERIC := 1;
    i INTEGER;
BEGIN
    -- No tiles revealed = 1x multiplier
    IF p_revealed_count = 0 THEN
        RETURN 1.0;
    END IF;

    v_safe_tiles := v_total_tiles - p_mines_count;

    -- Calculate probability-based multiplier
    -- P(success) = (safeTiles/totalTiles) * ((safeTiles-1)/(totalTiles-1)) * ... for each reveal
    FOR i IN 0..(p_revealed_count - 1) LOOP
        v_numerator := v_numerator * (v_total_tiles - i);
        v_denominator := v_denominator * (v_safe_tiles - i);
    END LOOP;

    -- Multiplier = 1/probability * (1 - houseEdge)
    v_multiplier := (v_numerator / v_denominator) * (1 - v_house_edge);
    
    -- Round to 2 decimal places
    RETURN ROUND(v_multiplier, 2);
END;
$$;

-- ========================================
-- START MINES GAME RPC FUNCTION (ATOMIC)
-- ========================================

CREATE OR REPLACE FUNCTION mines_start(
    p_user_id UUID,
    p_bet_amount NUMERIC,
    p_mines_count INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_game_id UUID;
    v_mine_positions INTEGER[];
    v_all_positions INTEGER[];
    v_safe_count INTEGER;
    v_random_idx INTEGER;
    v_temp INTEGER;
    i INTEGER;
    j INTEGER;
BEGIN
    -- Validate inputs
    IF p_bet_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is 10 cash');
    END IF;

    IF p_mines_count < 1 OR p_mines_count > 24 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Mines count must be between 1 and 24');
    END IF;

    -- Check for existing active game
    IF EXISTS (SELECT 1 FROM public.mines_games WHERE user_id = p_user_id AND status = 'active') THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active Mines game');
    END IF;

    -- Lock user row and get current cash
    SELECT cash INTO v_current_cash
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    -- Check sufficient balance
    IF v_current_cash < p_bet_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;

    -- Generate random mine positions using Fisher-Yates shuffle
    -- Create array of all positions (0-24)
    v_all_positions := ARRAY(SELECT generate_series(0, 24));
    
    -- Shuffle and take first p_mines_count positions
    FOR i IN 0..23 LOOP
        v_random_idx := i + floor(random() * (25 - i))::INTEGER;
        v_temp := v_all_positions[v_random_idx + 1];
        v_all_positions[v_random_idx + 1] := v_all_positions[i + 1];
        v_all_positions[i + 1] := v_temp;
    END LOOP;
    
    v_mine_positions := v_all_positions[1:p_mines_count];

    -- Deduct bet from balance
    v_new_cash := v_current_cash - p_bet_amount;
    
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Record bet transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_new_cash, 
            format('Mines bet (%s mines)', p_mines_count),
            jsonb_build_object('game', 'mines', 'mines_count', p_mines_count));

    -- Create game record
    INSERT INTO public.mines_games (user_id, bet_amount, mines_count, mine_positions, current_multiplier)
    VALUES (p_user_id, p_bet_amount, p_mines_count, to_jsonb(v_mine_positions), 1.0)
    RETURNING id INTO v_game_id;

    -- Return success with game info (NO mine positions sent to client)
    RETURN jsonb_build_object(
        'success', true,
        'gameId', v_game_id,
        'betAmount', p_bet_amount,
        'minesCount', p_mines_count,
        'newBalance', v_new_cash,
        'currentMultiplier', 1.0,
        'nextMultiplier', get_mines_multiplier(p_mines_count, 1)
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- REVEAL TILE RPC FUNCTION (ATOMIC)
-- ========================================

CREATE OR REPLACE FUNCTION mines_reveal(
    p_user_id UUID,
    p_game_id UUID,
    p_tile_index INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_game RECORD;
    v_is_mine BOOLEAN;
    v_revealed_tiles JSONB;
    v_revealed_count INTEGER;
    v_new_multiplier NUMERIC;
    v_next_multiplier NUMERIC;
    v_safe_count INTEGER;
BEGIN
    -- Validate tile index
    IF p_tile_index < 0 OR p_tile_index > 24 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid tile index');
    END IF;

    -- Get and lock game
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE id = p_game_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not found');
    END IF;

    IF v_game.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game is not active');
    END IF;

    -- Check if tile already revealed
    IF v_game.revealed_tiles @> to_jsonb(p_tile_index) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tile already revealed');
    END IF;

    -- Check if tile is a mine
    v_is_mine := v_game.mine_positions @> to_jsonb(p_tile_index);

    IF v_is_mine THEN
        -- Hit a mine - game over
        UPDATE public.mines_games
        SET status = 'lost', 
            revealed_tiles = revealed_tiles || to_jsonb(p_tile_index),
            updated_at = NOW()
        WHERE id = p_game_id;

        -- Record loss transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        SELECT p_user_id, 'loss', v_game.bet_amount, u.cash,
               format('Mines loss (hit mine at tile %s)', p_tile_index),
               jsonb_build_object('game', 'mines', 'game_id', p_game_id)
        FROM public.users u WHERE u.id = p_user_id;

        -- Update stats
        PERFORM update_game_stats(p_user_id, false);

        RETURN jsonb_build_object(
            'success', true,
            'result', 'mine',
            'tileIndex', p_tile_index,
            'gameOver', true,
            'minePositions', v_game.mine_positions
        );
    ELSE
        -- Safe tile
        v_revealed_tiles := v_game.revealed_tiles || to_jsonb(p_tile_index);
        v_revealed_count := jsonb_array_length(v_revealed_tiles);
        v_safe_count := 25 - v_game.mines_count;
        
        -- Calculate new multiplier
        v_new_multiplier := get_mines_multiplier(v_game.mines_count, v_revealed_count);
        v_next_multiplier := get_mines_multiplier(v_game.mines_count, v_revealed_count + 1);

        -- Update game
        UPDATE public.mines_games
        SET revealed_tiles = v_revealed_tiles,
            current_multiplier = v_new_multiplier,
            updated_at = NOW()
        WHERE id = p_game_id;

        -- Check if all safe tiles revealed (auto-win)
        IF v_revealed_count >= v_safe_count THEN
            -- Auto cash out
            RETURN mines_cashout(p_user_id, p_game_id);
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'result', 'safe',
            'tileIndex', p_tile_index,
            'revealedCount', v_revealed_count,
            'currentMultiplier', v_new_multiplier,
            'nextMultiplier', v_next_multiplier,
            'potentialWin', ROUND(v_game.bet_amount * v_new_multiplier, 2),
            'gameOver', false
        );
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- CASH OUT RPC FUNCTION (ATOMIC)
-- ========================================

CREATE OR REPLACE FUNCTION mines_cashout(
    p_user_id UUID,
    p_game_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_game RECORD;
    v_current_cash NUMERIC;
    v_winnings NUMERIC;
    v_new_cash NUMERIC;
    v_revealed_count INTEGER;
BEGIN
    -- Get and lock game
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE id = p_game_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not found');
    END IF;

    IF v_game.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game is not active');
    END IF;

    v_revealed_count := jsonb_array_length(v_game.revealed_tiles);

    IF v_revealed_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Must reveal at least one tile before cashing out');
    END IF;

    -- Calculate winnings
    v_winnings := ROUND(v_game.bet_amount * v_game.current_multiplier, 2);

    -- Get current balance and update
    SELECT cash INTO v_current_cash
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    v_new_cash := v_current_cash + v_winnings;

    UPDATE public.users
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Update game status
    UPDATE public.mines_games
    SET status = 'won', updated_at = NOW()
    WHERE id = p_game_id;

    -- Record win transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'win', v_winnings, v_new_cash,
            format('Mines win (%sx multiplier, %s tiles revealed)', v_game.current_multiplier, v_revealed_count),
            jsonb_build_object('game', 'mines', 'game_id', p_game_id, 'multiplier', v_game.current_multiplier));

    -- Update stats
    PERFORM update_game_stats(p_user_id, true);

    RETURN jsonb_build_object(
        'success', true,
        'result', 'cashout',
        'gameOver', true,
        'winnings', v_winnings,
        'multiplier', v_game.current_multiplier,
        'revealedCount', v_revealed_count,
        'newBalance', v_new_cash,
        'minePositions', v_game.mine_positions
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- GET ACTIVE GAME FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION mines_get_active(
    p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_game RECORD;
    v_revealed_count INTEGER;
    v_next_multiplier NUMERIC;
BEGIN
    SELECT * INTO v_game
    FROM public.mines_games
    WHERE user_id = p_user_id AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'hasActiveGame', false);
    END IF;

    v_revealed_count := jsonb_array_length(v_game.revealed_tiles);
    v_next_multiplier := get_mines_multiplier(v_game.mines_count, v_revealed_count + 1);

    RETURN jsonb_build_object(
        'success', true,
        'hasActiveGame', true,
        'gameId', v_game.id,
        'betAmount', v_game.bet_amount,
        'minesCount', v_game.mines_count,
        'revealedTiles', v_game.revealed_tiles,
        'currentMultiplier', v_game.current_multiplier,
        'nextMultiplier', v_next_multiplier,
        'potentialWin', ROUND(v_game.bet_amount * v_game.current_multiplier, 2)
    );
END;
$$;
