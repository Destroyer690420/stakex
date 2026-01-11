-- ========================================
-- SLOTS GAME RPC FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS slots_spin(uuid, numeric);

-- ========================================
-- SYMBOLS AND PAYOUTS
-- Symbols: 🍒, 🍋, 🍊, 🍇, 🔔, 💎, 7️⃣
-- Payouts:
--   3x 7️⃣ = 20x
--   3x 💎 = 10x
--   Any 3 matching = 5x
--   2 matching = 1.5x
--   No match = 0x
-- ========================================

-- Symbol weights for weighted random selection (lower = rarer)
-- 7️⃣ = 2, 💎 = 5, 🔔 = 10, 🍇 = 15, 🍊 = 18, 🍋 = 22, 🍒 = 28

CREATE OR REPLACE FUNCTION slots_spin(
    p_user_id UUID,
    p_bet_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_symbols TEXT[] := ARRAY['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣'];
    v_weights INTEGER[] := ARRAY[28, 22, 18, 15, 10, 5, 2]; -- Higher = more common
    v_total_weight INTEGER := 100;
    v_reel1 TEXT;
    v_reel2 TEXT;
    v_reel3 TEXT;
    v_multiplier NUMERIC := 0;
    v_winnings NUMERIC := 0;
    v_random INTEGER;
    v_cumulative INTEGER;
    i INTEGER;
BEGIN
    -- Validate bet amount
    IF p_bet_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is 10');
    END IF;

    IF p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is 10,000');
    END IF;

    -- Lock user row and get current balance
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

    -- Deduct bet immediately
    v_new_cash := v_current_cash - p_bet_amount;
    
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Generate 3 random symbols using weighted selection
    -- Reel 1
    v_random := floor(random() * v_total_weight)::INTEGER;
    v_cumulative := 0;
    FOR i IN 1..array_length(v_weights, 1) LOOP
        v_cumulative := v_cumulative + v_weights[i];
        IF v_random < v_cumulative THEN
            v_reel1 := v_symbols[i];
            EXIT;
        END IF;
    END LOOP;

    -- Reel 2
    v_random := floor(random() * v_total_weight)::INTEGER;
    v_cumulative := 0;
    FOR i IN 1..array_length(v_weights, 1) LOOP
        v_cumulative := v_cumulative + v_weights[i];
        IF v_random < v_cumulative THEN
            v_reel2 := v_symbols[i];
            EXIT;
        END IF;
    END LOOP;

    -- Reel 3
    v_random := floor(random() * v_total_weight)::INTEGER;
    v_cumulative := 0;
    FOR i IN 1..array_length(v_weights, 1) LOOP
        v_cumulative := v_cumulative + v_weights[i];
        IF v_random < v_cumulative THEN
            v_reel3 := v_symbols[i];
            EXIT;
        END IF;
    END LOOP;

    -- Calculate multiplier based on payout rules
    IF v_reel1 = v_reel2 AND v_reel2 = v_reel3 THEN
        -- All 3 match
        IF v_reel1 = '7️⃣' THEN
            v_multiplier := 20;
        ELSIF v_reel1 = '💎' THEN
            v_multiplier := 10;
        ELSE
            v_multiplier := 5;
        END IF;
    ELSIF v_reel1 = v_reel2 OR v_reel2 = v_reel3 OR v_reel1 = v_reel3 THEN
        -- 2 matching
        v_multiplier := 1.5;
    ELSE
        -- No match
        v_multiplier := 0;
    END IF;

    -- Calculate and add winnings
    v_winnings := ROUND(p_bet_amount * v_multiplier, 2);
    
    IF v_winnings > 0 THEN
        v_new_cash := v_new_cash + v_winnings;
        
        UPDATE public.users 
        SET cash = v_new_cash, updated_at = NOW()
        WHERE id = p_user_id;

        -- Record win transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'win', v_winnings, v_new_cash,
                format('Slots win: %sx multiplier on %s%s%s', v_multiplier, v_reel1, v_reel2, v_reel3),
                jsonb_build_object('game', 'slots', 'multiplier', v_multiplier, 'symbols', ARRAY[v_reel1, v_reel2, v_reel3]));
    END IF;

    -- Record bet transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_current_cash - p_bet_amount,
            format('Slots bet: %s', p_bet_amount),
            jsonb_build_object('game', 'slots'));

    -- Update game stats
    PERFORM update_game_stats(p_user_id, v_multiplier > 0);

    -- Create game session record
    INSERT INTO public.game_sessions (game_type, players, status, result, bets, ended_at)
    VALUES ('slots',
            jsonb_build_array(jsonb_build_object('userId', p_user_id)),
            'completed',
            jsonb_build_object(
                'symbols', ARRAY[v_reel1, v_reel2, v_reel3],
                'multiplier', v_multiplier,
                'won', v_multiplier > 0
            ),
            jsonb_build_array(jsonb_build_object(
                'userId', p_user_id,
                'amount', p_bet_amount,
                'payout', v_winnings,
                'outcome', CASE WHEN v_multiplier > 0 THEN 'win' ELSE 'loss' END
            )),
            NOW());

    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'symbols', ARRAY[v_reel1, v_reel2, v_reel3],
        'multiplier', v_multiplier,
        'won', v_multiplier > 0,
        'betAmount', p_bet_amount,
        'winnings', v_winnings,
        'newBalance', v_new_cash
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
