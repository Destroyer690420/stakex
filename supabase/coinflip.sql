-- ========================================
-- COINFLIP GAME SCHEMA FOR SUPABASE
-- Single-Player (Player vs House)
-- Run this in Supabase SQL Editor
-- ========================================

-- Drop existing PvP functions and table (cleanup)
DROP FUNCTION IF EXISTS create_coinflip_room(uuid, numeric, text);
DROP FUNCTION IF EXISTS join_coinflip_battle(uuid, uuid);
DROP FUNCTION IF EXISTS cancel_coinflip_room(uuid, uuid);
DROP FUNCTION IF EXISTS fn_flip_coin(uuid, numeric, text);
DROP TABLE IF EXISTS public.coinflip_rooms;

-- ========================================
-- SINGLE-PLAYER COIN FLIP RPC
-- Player vs House with 1.98x payout (1% house edge)
-- ========================================

CREATE OR REPLACE FUNCTION fn_flip_coin(
    p_user_id UUID,
    p_bet_amount NUMERIC,
    p_chosen_side TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_username TEXT;
    v_flip_result TEXT;
    v_won BOOLEAN;
    v_payout_multiplier NUMERIC := 1.98; -- 1% house edge
    v_payout NUMERIC := 0;
BEGIN
    -- Validate inputs
    IF p_bet_amount < 10 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum bet is $10');
    END IF;

    IF p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Maximum bet is $10,000');
    END IF;

    IF p_chosen_side NOT IN ('heads', 'tails') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Side must be heads or tails');
    END IF;

    -- Lock user row and get current balance
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

    -- Deduct bet from user
    v_new_cash := v_current_cash - p_bet_amount;
    
    UPDATE public.users 
    SET cash = v_new_cash, updated_at = NOW()
    WHERE id = p_user_id;

    -- Record bet transaction
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, 'bet', p_bet_amount, v_new_cash,
            format('Coin flip bet on %s', p_chosen_side),
            jsonb_build_object('game', 'coinflip', 'side', p_chosen_side));

    -- FLIP THE COIN (server-side RNG)
    v_flip_result := CASE WHEN random() < 0.5 THEN 'heads' ELSE 'tails' END;
    
    -- Check if user won
    v_won := (v_flip_result = p_chosen_side);

    -- If won, calculate and credit payout
    IF v_won THEN
        v_payout := ROUND(p_bet_amount * v_payout_multiplier, 2);
        v_new_cash := v_new_cash + v_payout;

        UPDATE public.users
        SET cash = v_new_cash, updated_at = NOW()
        WHERE id = p_user_id;

        -- Record win transaction
        INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (p_user_id, 'win', v_payout, v_new_cash,
                'Coin flip win! ' || v_flip_result || ' (1.98x)',
                jsonb_build_object('game', 'coinflip', 'result', v_flip_result, 'multiplier', v_payout_multiplier));
    END IF;

    -- Update user game stats
    PERFORM update_game_stats(p_user_id, v_won);

    -- Record game session
    INSERT INTO public.game_sessions (game_type, players, status, result, bets, ended_at)
    VALUES ('coinflip',
            jsonb_build_array(jsonb_build_object('userId', p_user_id, 'username', v_username)),
            'completed',
            jsonb_build_object('flip_result', v_flip_result, 'chosen_side', p_chosen_side, 'won', v_won, 'multiplier', v_payout_multiplier),
            jsonb_build_array(jsonb_build_object('userId', p_user_id, 'amount', p_bet_amount, 'payout', v_payout)),
            NOW());

    -- Return result
    RETURN jsonb_build_object(
        'success', true,
        'flipResult', v_flip_result,
        'chosenSide', p_chosen_side,
        'won', v_won,
        'betAmount', p_bet_amount,
        'payout', v_payout,
        'newBalance', v_new_cash
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
