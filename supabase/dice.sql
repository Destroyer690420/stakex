-- ========================================
-- DICE GAME SCHEMA FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS fn_play_dice(uuid, numeric, numeric, boolean);

-- ========================================
-- PLAY DICE RPC FUNCTION (ATOMIC)
-- 100-sided dice (0.00 - 99.99)
-- House edge: 1%
-- ========================================

CREATE OR REPLACE FUNCTION fn_play_dice(
    p_user_id UUID,
    p_bet_amount NUMERIC,
    p_target_value NUMERIC,
    p_is_over BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_roll_result NUMERIC;
    v_win_chance NUMERIC;
    v_multiplier NUMERIC;
    v_won BOOLEAN;
    v_payout NUMERIC;
    v_house_edge NUMERIC := 0.01; -- 1% house edge
BEGIN
    -- Validate bet amount
    IF p_bet_amount < 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is $1');
    END IF;

    IF p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is $10,000');
    END IF;

    -- Validate target value (must be between 0.01 and 99.98 to allow winning)
    IF p_target_value < 0.01 OR p_target_value > 99.98 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target must be between 0.01 and 99.98');
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

    -- Calculate win chance based on mode
    IF p_is_over THEN
        -- Roll Over: win if roll > target
        v_win_chance := 99.99 - p_target_value;
    ELSE
        -- Roll Under: win if roll < target
        v_win_chance := p_target_value;
    END IF;

    -- Ensure win chance is valid
    IF v_win_chance <= 0 OR v_win_chance >= 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid target for selected mode');
    END IF;

    -- Calculate multiplier with house edge
    -- Formula: 99 / win_chance (includes 1% edge since 99 instead of 100)
    v_multiplier := ROUND(99.0 / v_win_chance, 4);

    -- Deduct bet from balance
    v_new_cash := v_current_cash - p_bet_amount;
    
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Generate random roll result (0.00 to 99.99)
    v_roll_result := ROUND((random() * 99.99)::NUMERIC, 2);

    -- Determine win/loss
    IF p_is_over THEN
        v_won := v_roll_result > p_target_value;
    ELSE
        v_won := v_roll_result < p_target_value;
    END IF;

    -- Calculate payout if won
    IF v_won THEN
        v_payout := ROUND(p_bet_amount * v_multiplier, 2);
        v_new_cash := v_new_cash + v_payout;
        
        UPDATE public.users 
        SET cash = v_new_cash, updated_at = NOW()
        WHERE id = p_user_id;

        -- Record win transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'win', v_payout, v_new_cash,
                format('Dice win - Roll %s %s %s (Result: %s)', 
                       CASE WHEN p_is_over THEN 'Over' ELSE 'Under' END,
                       p_target_value, 
                       CASE WHEN p_is_over THEN '>' ELSE '<' END,
                       v_roll_result),
                jsonb_build_object(
                    'game', 'dice',
                    'roll', v_roll_result,
                    'target', p_target_value,
                    'is_over', p_is_over,
                    'multiplier', v_multiplier
                ));

        -- Update stats
        PERFORM update_game_stats(p_user_id, true);
    ELSE
        v_payout := 0;

        -- Record loss transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'loss', p_bet_amount, v_new_cash,
                format('Dice loss - Roll %s %s (Result: %s)', 
                       CASE WHEN p_is_over THEN 'Over' ELSE 'Under' END,
                       p_target_value, 
                       v_roll_result),
                jsonb_build_object(
                    'game', 'dice',
                    'roll', v_roll_result,
                    'target', p_target_value,
                    'is_over', p_is_over,
                    'multiplier', v_multiplier
                ));

        -- Update stats
        PERFORM update_game_stats(p_user_id, false);
    END IF;

    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'roll', v_roll_result,
        'target', p_target_value,
        'isOver', p_is_over,
        'won', v_won,
        'multiplier', v_multiplier,
        'winChance', ROUND(v_win_chance, 2),
        'betAmount', p_bet_amount,
        'payout', v_payout,
        'newBalance', v_new_cash
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION fn_play_dice(uuid, numeric, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_play_dice(uuid, numeric, numeric, boolean) TO service_role;
