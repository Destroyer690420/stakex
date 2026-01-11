-- ========================================
-- EUROPEAN ROULETTE SCHEMA FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ========================================

-- Roulette History Table (stores all spins)
CREATE TABLE IF NOT EXISTS public.roulette_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    result INTEGER NOT NULL CHECK (result >= 0 AND result <= 36),
    color TEXT NOT NULL CHECK (color IN ('green', 'red', 'black')),
    total_bet NUMERIC NOT NULL DEFAULT 0,
    total_win NUMERIC NOT NULL DEFAULT 0,
    bets JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for fast history queries
CREATE INDEX IF NOT EXISTS idx_roulette_history_created_at ON public.roulette_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roulette_history_user_id ON public.roulette_history(user_id);

-- Enable RLS
ALTER TABLE public.roulette_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view all roulette history" ON public.roulette_history
    FOR SELECT USING (true);

CREATE POLICY "System can insert roulette history" ON public.roulette_history
    FOR INSERT WITH CHECK (true);

-- ========================================
-- ROULETTE SPIN RPC FUNCTION (ATOMIC)
-- ========================================

CREATE OR REPLACE FUNCTION roulette_spin(
    p_user_id UUID,
    p_bets JSONB  -- Array of bets: [{type, value, amount}, ...]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_total_bet NUMERIC := 0;
    v_result INTEGER;
    v_color TEXT;
    v_total_win NUMERIC := 0;
    v_bet JSONB;
    v_bet_type TEXT;
    v_bet_value JSONB;
    v_bet_amount NUMERIC;
    v_win_amount NUMERIC;
    v_new_cash NUMERIC;
    v_history_id UUID;
    -- Roulette number colors (0=green, then alternating pattern)
    v_red_numbers INTEGER[] := ARRAY[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
BEGIN
    -- Lock user row and get current cash
    SELECT cash INTO v_current_cash
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- Calculate total bet amount
    FOR v_bet IN SELECT * FROM jsonb_array_elements(p_bets)
    LOOP
        v_bet_amount := (v_bet->>'amount')::NUMERIC;
        IF v_bet_amount <= 0 THEN
            RAISE EXCEPTION 'Invalid bet amount';
        END IF;
        v_total_bet := v_total_bet + v_bet_amount;
    END LOOP;

    -- Check sufficient balance
    IF v_current_cash < v_total_bet THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- Generate random result (0-36)
    v_result := floor(random() * 37)::INTEGER;

    -- Determine color
    IF v_result = 0 THEN
        v_color := 'green';
    ELSIF v_result = ANY(v_red_numbers) THEN
        v_color := 'red';
    ELSE
        v_color := 'black';
    END IF;

    -- Calculate winnings for each bet
    FOR v_bet IN SELECT * FROM jsonb_array_elements(p_bets)
    LOOP
        v_bet_type := v_bet->>'type';
        v_bet_value := v_bet->'value';
        v_bet_amount := (v_bet->>'amount')::NUMERIC;
        v_win_amount := 0;

        -- INSIDE BETS
        IF v_bet_type = 'straight' THEN
            -- Single number (35:1)
            IF (v_bet_value->>0)::INTEGER = v_result THEN
                v_win_amount := v_bet_amount * 36; -- 35:1 + original bet
            END IF;

        ELSIF v_bet_type = 'split' THEN
            -- Two adjacent numbers (17:1)
            IF v_result = (v_bet_value->>0)::INTEGER OR v_result = (v_bet_value->>1)::INTEGER THEN
                v_win_amount := v_bet_amount * 18;
            END IF;

        ELSIF v_bet_type = 'street' THEN
            -- Row of 3 (11:1)
            IF v_result >= (v_bet_value->>0)::INTEGER AND v_result <= (v_bet_value->>0)::INTEGER + 2 THEN
                v_win_amount := v_bet_amount * 12;
            END IF;

        ELSIF v_bet_type = 'corner' THEN
            -- 4 numbers (8:1)
            IF v_result = (v_bet_value->>0)::INTEGER OR v_result = (v_bet_value->>1)::INTEGER 
               OR v_result = (v_bet_value->>2)::INTEGER OR v_result = (v_bet_value->>3)::INTEGER THEN
                v_win_amount := v_bet_amount * 9;
            END IF;

        ELSIF v_bet_type = 'line' THEN
            -- 6 numbers (5:1)
            IF v_result >= (v_bet_value->>0)::INTEGER AND v_result <= (v_bet_value->>0)::INTEGER + 5 THEN
                v_win_amount := v_bet_amount * 6;
            END IF;

        -- OUTSIDE BETS
        ELSIF v_bet_type = 'red' THEN
            IF v_color = 'red' THEN
                v_win_amount := v_bet_amount * 2;
            END IF;

        ELSIF v_bet_type = 'black' THEN
            IF v_color = 'black' THEN
                v_win_amount := v_bet_amount * 2;
            END IF;

        ELSIF v_bet_type = 'odd' THEN
            IF v_result > 0 AND v_result % 2 = 1 THEN
                v_win_amount := v_bet_amount * 2;
            END IF;

        ELSIF v_bet_type = 'even' THEN
            IF v_result > 0 AND v_result % 2 = 0 THEN
                v_win_amount := v_bet_amount * 2;
            END IF;

        ELSIF v_bet_type = 'low' THEN
            -- 1-18
            IF v_result >= 1 AND v_result <= 18 THEN
                v_win_amount := v_bet_amount * 2;
            END IF;

        ELSIF v_bet_type = 'high' THEN
            -- 19-36
            IF v_result >= 19 AND v_result <= 36 THEN
                v_win_amount := v_bet_amount * 2;
            END IF;

        ELSIF v_bet_type = 'dozen1' THEN
            -- 1-12
            IF v_result >= 1 AND v_result <= 12 THEN
                v_win_amount := v_bet_amount * 3;
            END IF;

        ELSIF v_bet_type = 'dozen2' THEN
            -- 13-24
            IF v_result >= 13 AND v_result <= 24 THEN
                v_win_amount := v_bet_amount * 3;
            END IF;

        ELSIF v_bet_type = 'dozen3' THEN
            -- 25-36
            IF v_result >= 25 AND v_result <= 36 THEN
                v_win_amount := v_bet_amount * 3;
            END IF;

        ELSIF v_bet_type = 'column1' THEN
            -- 1,4,7,10,13,16,19,22,25,28,31,34
            IF v_result > 0 AND (v_result - 1) % 3 = 0 THEN
                v_win_amount := v_bet_amount * 3;
            END IF;

        ELSIF v_bet_type = 'column2' THEN
            -- 2,5,8,11,14,17,20,23,26,29,32,35
            IF v_result > 0 AND (v_result - 2) % 3 = 0 THEN
                v_win_amount := v_bet_amount * 3;
            END IF;

        ELSIF v_bet_type = 'column3' THEN
            -- 3,6,9,12,15,18,21,24,27,30,33,36
            IF v_result > 0 AND v_result % 3 = 0 THEN
                v_win_amount := v_bet_amount * 3;
            END IF;

        END IF;

        v_total_win := v_total_win + v_win_amount;
    END LOOP;

    -- Update user balance: subtract bet, add winnings
    v_new_cash := v_current_cash - v_total_bet + v_total_win;
    
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Record bet transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'game_loss', v_total_bet, v_current_cash - v_total_bet, 
            'Roulette bet', jsonb_build_object('game', 'roulette', 'result', v_result));

    -- Record win transaction (if any)
    IF v_total_win > 0 THEN
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'game_win', v_total_win, v_new_cash,
                format('Roulette win on %s', v_result), jsonb_build_object('game', 'roulette', 'result', v_result));
    END IF;

    -- Record in roulette history
    INSERT INTO public.roulette_history (user_id, result, color, total_bet, total_win, bets)
    VALUES (p_user_id, v_result, v_color, v_total_bet, v_total_win, p_bets)
    RETURNING id INTO v_history_id;

    -- Update user stats
    PERFORM update_game_stats(p_user_id, v_total_win > 0);

    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'result', v_result,
        'color', v_color,
        'totalBet', v_total_bet,
        'totalWin', v_total_win,
        'netResult', v_total_win - v_total_bet,
        'newBalance', v_new_cash,
        'historyId', v_history_id
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;
