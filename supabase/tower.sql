-- ========================================
-- TOWER GAME SCHEMA FOR SUPABASE
-- FIXED VERSION - SIMPLIFIED FOR RELIABILITY
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop existing objects to ensure clean install
DROP TABLE IF EXISTS tower_sessions CASCADE;
DROP FUNCTION IF EXISTS fn_start_tower(UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS fn_climb_tower(UUID, UUID, INTEGER);
DROP FUNCTION IF EXISTS fn_cashout_tower(UUID, UUID);
DROP FUNCTION IF EXISTS get_tower_multiplier(INTEGER, TEXT);

-- ========================================
-- CREATE TOWER SESSIONS TABLE
-- ========================================
CREATE TABLE tower_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bet_amount NUMERIC(10, 2) NOT NULL CHECK (bet_amount > 0),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    current_row INTEGER NOT NULL DEFAULT 0 CHECK (current_row >= 0 AND current_row <= 10),
    grid_state JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'cashed_out', 'exploded')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for efficient queries
CREATE INDEX idx_tower_sessions_user_status ON tower_sessions(user_id, status);

-- ========================================
-- HELPER FUNCTION: Calculate Tower Multipliers
-- Different multipliers for each difficulty!
-- ========================================
CREATE OR REPLACE FUNCTION get_tower_multiplier(p_row INTEGER, p_difficulty TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
    -- Return multiplier based on difficulty and row
    IF p_row >= 0 AND p_row < 10 THEN
        CASE p_difficulty
            WHEN 'easy' THEN 
                -- Easy: 80% win rate per row
                RETURN ROUND((1.25 ^ (p_row + 1))::NUMERIC, 2);
            WHEN 'medium' THEN 
                -- Medium: 60% win rate per row
                RETURN ROUND((1.67 ^ (p_row + 1))::NUMERIC, 2);
            WHEN 'hard' THEN 
                -- Hard: 40% win rate per row
                RETURN ROUND((2.5 ^ (p_row + 1))::NUMERIC, 2);
            ELSE 
                RETURN ROUND((1.25 ^ (p_row + 1))::NUMERIC, 2);
        END CASE;
    END IF;
    RETURN 1.0;
END;
$$;

-- ========================================
-- START TOWER GAME
-- ========================================
CREATE OR REPLACE FUNCTION fn_start_tower(
    p_user_id UUID,
    p_bet_amount NUMERIC,
    p_difficulty TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_game_id UUID;
    v_grid_state JSONB;
    v_row INTEGER;
    v_mine_count INTEGER;
    v_row_array JSONB;
    v_mine_positions INTEGER[];
    v_pos INTEGER;
BEGIN
    -- Validate bet amount
    IF p_bet_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is $10');
    END IF;

    IF p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is $10,000');
    END IF;

    -- Validate difficulty
    IF p_difficulty NOT IN ('easy', 'medium', 'hard') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid difficulty');
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

    -- Deduct bet from balance
    v_new_cash := v_current_cash - p_bet_amount;
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Record bet transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_new_cash, 
            format('Tower bet - %s mode', p_difficulty),
            jsonb_build_object('game', 'tower', 'difficulty', p_difficulty));

    -- Determine mine count per row based on difficulty
    CASE p_difficulty
        WHEN 'easy' THEN v_mine_count := 1;   -- 4 safe, 1 mine
        WHEN 'medium' THEN v_mine_count := 2;  -- 3 safe, 2 mines
        WHEN 'hard' THEN v_mine_count := 3;    -- 2 safe, 3 mines
    END CASE;

    -- Generate grid state: 10 rows x 5 columns
    -- Each row is an array of 5 integers: 0 = safe, 1 = mine
    v_grid_state := '[]'::jsonb;
    
    FOR v_row IN 0..9 LOOP
        -- Start with all safe [0,0,0,0,0]
        v_row_array := '[0,0,0,0,0]'::jsonb;
        
        -- Generate unique random mine positions
        v_mine_positions := ARRAY[]::INTEGER[];
        WHILE array_length(v_mine_positions, 1) IS NULL OR array_length(v_mine_positions, 1) < v_mine_count LOOP
            v_pos := floor(random() * 5)::INTEGER;
            IF NOT (v_pos = ANY(v_mine_positions)) THEN
                v_mine_positions := array_append(v_mine_positions, v_pos);
            END IF;
        END LOOP;
        
        -- Set mine positions to 1
        FOREACH v_pos IN ARRAY v_mine_positions LOOP
            v_row_array := jsonb_set(v_row_array, ARRAY[v_pos::text], '1'::jsonb);
        END LOOP;
        
        -- Append row to grid
        v_grid_state := v_grid_state || jsonb_build_array(v_row_array);
    END LOOP;

    -- Create game session
    INSERT INTO tower_sessions (user_id, bet_amount, difficulty, current_row, grid_state, status)
    VALUES (p_user_id, p_bet_amount, p_difficulty, 0, v_grid_state, 'active')
    RETURNING id INTO v_game_id;

    -- Return game data
    RETURN jsonb_build_object(
        'success', true,
        'gameId', v_game_id,
        'currentRow', 0,
        'currentMultiplier', 1.0,
        'nextMultiplier', get_tower_multiplier(0, p_difficulty),
        'newBalance', v_new_cash
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- CLIMB TOWER (Select a tile)
-- ========================================
CREATE OR REPLACE FUNCTION fn_climb_tower(
    p_game_id UUID,
    p_user_id UUID,
    p_selected_col_index INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_session RECORD;
    v_tile_value INTEGER;
    v_new_row INTEGER;
    v_multiplier NUMERIC;
    v_next_multiplier NUMERIC;
    v_payout NUMERIC;
    v_new_cash NUMERIC;
    v_mine_positions JSONB;
    i INTEGER;
    j INTEGER;
BEGIN
    -- Validate column index
    IF p_selected_col_index < 0 OR p_selected_col_index > 4 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid column index');
    END IF;

    -- Get game session
    SELECT * INTO v_session
    FROM tower_sessions
    WHERE id = p_game_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not found');
    END IF;

    -- Check if game is active
    IF v_session.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game is not active');
    END IF;

    -- Get the tile value from grid_state
    -- grid_state is array of arrays: [[0,1,0,0,0], [0,0,1,0,0], ...]
    -- 0 = safe, 1 = mine
    v_tile_value := (v_session.grid_state->v_session.current_row->p_selected_col_index)::INTEGER;

    -- ========== MINE HIT (tile value = 1) ==========
    IF v_tile_value = 1 THEN
        -- Update session status
        UPDATE tower_sessions
        SET status = 'exploded', updated_at = NOW()
        WHERE id = p_game_id;

        -- Get current balance for transaction
        SELECT cash INTO v_new_cash FROM users WHERE id = p_user_id;

        -- Record loss transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'loss', v_session.bet_amount, v_new_cash,
                format('Tower loss - Hit mine at row %s', v_session.current_row + 1),
                jsonb_build_object(
                    'game', 'tower',
                    'difficulty', v_session.difficulty,
                    'row_reached', v_session.current_row
                ));

        -- Update stats
        PERFORM update_game_stats(p_user_id, false);

        -- Build mine positions for reveal (find all 1s in grid)
        v_mine_positions := '[]'::jsonb;
        FOR i IN 0..9 LOOP
            FOR j IN 0..4 LOOP
                IF (v_session.grid_state->i->j)::INTEGER = 1 THEN
                    v_mine_positions := v_mine_positions || jsonb_build_object('row', i, 'col', j);
                END IF;
            END LOOP;
        END LOOP;

        RETURN jsonb_build_object(
            'success', true,
            'result', 'boom',
            'minePositions', v_mine_positions
        );
    END IF;

    -- ========== SAFE TILE (tile value = 0) ==========
    v_new_row := v_session.current_row + 1;
    v_multiplier := get_tower_multiplier(v_new_row - 1, v_session.difficulty);

    -- Check if tower is complete (reached row 10)
    IF v_new_row >= 10 THEN
        -- Auto cash out
        v_payout := ROUND(v_session.bet_amount * v_multiplier, 2);
        
        -- Credit payout
        UPDATE public.users
        SET cash = cash + v_payout, updated_at = NOW()
        WHERE id = p_user_id
        RETURNING cash INTO v_new_cash;

        -- Update session
        UPDATE tower_sessions
        SET status = 'cashed_out', current_row = v_new_row, updated_at = NOW()
        WHERE id = p_game_id;

        -- Record win transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'win', v_payout, v_new_cash,
                'Tower win - Completed all rows (' || v_multiplier || 'x)',
                jsonb_build_object(
                    'game', 'tower',
                    'difficulty', v_session.difficulty,
                    'multiplier', v_multiplier,
                    'rows_completed', 10
                ));

        -- Update stats
        PERFORM update_game_stats(p_user_id, true);

        -- Build mine positions for reveal
        v_mine_positions := '[]'::jsonb;
        FOR i IN 0..9 LOOP
            FOR j IN 0..4 LOOP
                IF (v_session.grid_state->i->j)::INTEGER = 1 THEN
                    v_mine_positions := v_mine_positions || jsonb_build_object('row', i, 'col', j);
                END IF;
            END LOOP;
        END LOOP;

        RETURN jsonb_build_object(
            'success', true,
            'result', 'cashout',
            'multiplier', v_multiplier,
            'payout', v_payout,
            'newBalance', v_new_cash,
            'minePositions', v_mine_positions
        );
    END IF;

    -- Continue climbing
    v_next_multiplier := get_tower_multiplier(v_new_row, v_session.difficulty);

    UPDATE tower_sessions
    SET current_row = v_new_row, updated_at = NOW()
    WHERE id = p_game_id;

    RETURN jsonb_build_object(
        'success', true,
        'result', 'safe',
        'currentRow', v_new_row,
        'currentMultiplier', v_multiplier,
        'nextMultiplier', v_next_multiplier
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- CASHOUT TOWER
-- ========================================
CREATE OR REPLACE FUNCTION fn_cashout_tower(
    p_game_id UUID,
    p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_session RECORD;
    v_multiplier NUMERIC;
    v_payout NUMERIC;
    v_new_cash NUMERIC;
    v_mine_positions JSONB;
    i INTEGER;
    j INTEGER;
BEGIN
    -- Get game session
    SELECT * INTO v_session
    FROM tower_sessions
    WHERE id = p_game_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game not found');
    END IF;

    -- Check if game is active
    IF v_session.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Game is not active');
    END IF;

    -- Must have completed at least one row
    IF v_session.current_row = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Must complete at least one row before cashing out');
    END IF;

    -- Calculate payout
    v_multiplier := get_tower_multiplier(v_session.current_row - 1, v_session.difficulty);
    v_payout := ROUND(v_session.bet_amount * v_multiplier, 2);

    -- Credit payout
    UPDATE public.users
    SET cash = cash + v_payout, updated_at = NOW()
    WHERE id = p_user_id
    RETURNING cash INTO v_new_cash;

    -- Update session
    UPDATE tower_sessions
    SET status = 'cashed_out', updated_at = NOW()
    WHERE id = p_game_id;

    -- Record win transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'win', v_payout, v_new_cash,
            'Tower cashout - Row ' || v_session.current_row || ' (' || v_multiplier || 'x)',
            jsonb_build_object(
                'game', 'tower',
                'difficulty', v_session.difficulty,
                'multiplier', v_multiplier,
                'rows_completed', v_session.current_row
            ));

    -- Update stats
    PERFORM update_game_stats(p_user_id, true);

    -- Build mine positions for reveal
    v_mine_positions := '[]'::jsonb;
    FOR i IN 0..9 LOOP
        FOR j IN 0..4 LOOP
            IF (v_session.grid_state->i->j)::INTEGER = 1 THEN
                v_mine_positions := v_mine_positions || jsonb_build_object('row', i, 'col', j);
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'multiplier', v_multiplier,
        'payout', v_payout,
        'newBalance', v_new_cash,
        'rowsCompleted', v_session.current_row,
        'minePositions', v_mine_positions
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ========================================
-- GRANT PERMISSIONS
-- ========================================
GRANT EXECUTE ON FUNCTION fn_start_tower(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_start_tower(UUID, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fn_climb_tower(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_climb_tower(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION fn_cashout_tower(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_cashout_tower(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_tower_multiplier(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tower_multiplier(INTEGER, TEXT) TO service_role;

-- ========================================
-- TEST QUERY: Verify mine generation works
-- ========================================
-- Run this to test that mines are being generated:
-- SELECT get_tower_multiplier(0, 'easy'), get_tower_multiplier(0, 'medium'), get_tower_multiplier(0, 'hard');
-- SELECT get_tower_multiplier(9, 'easy'), get_tower_multiplier(9, 'medium'), get_tower_multiplier(9, 'hard');
