-- ========================================
-- FIX FOR JSONB_SET ERRORS
-- Run this in Supabase SQL Editor
-- ========================================

-- Fix process_transaction to use ARRAY[] for jsonb_set path
CREATE OR REPLACE FUNCTION process_transaction(
    p_user_id UUID,
    p_type TEXT,
    p_amount NUMERIC,
    p_description TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE(new_balance NUMERIC, transaction_id UUID) 
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_current_cash NUMERIC;
    v_new_cash NUMERIC;
    v_transaction_id UUID;
    v_stats JSONB;
BEGIN
    -- Lock the user row
    SELECT cash, stats INTO v_current_cash, v_stats
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    -- Calculate new balance based on transaction type
    IF p_type IN ('credit', 'admin_grant', 'game_win', 'bonus', 'win') THEN
        v_new_cash := v_current_cash + p_amount;
        
        -- Update stats for wins
        IF p_type IN ('game_win', 'win') THEN
            v_stats := jsonb_set(v_stats, ARRAY['lifetimeEarnings'], 
                to_jsonb((v_stats->>'lifetimeEarnings')::NUMERIC + p_amount));
            IF p_amount > (v_stats->>'biggestWin')::NUMERIC THEN
                v_stats := jsonb_set(v_stats, ARRAY['biggestWin'], to_jsonb(p_amount));
            END IF;
        END IF;
    ELSIF p_type IN ('debit', 'admin_deduct', 'game_loss', 'bet', 'loss') THEN
        IF v_current_cash < p_amount THEN
            RAISE EXCEPTION 'Insufficient balance';
        END IF;
        v_new_cash := v_current_cash - p_amount;
        
        -- Update stats for losses
        IF p_type IN ('game_loss', 'loss') THEN
            v_stats := jsonb_set(v_stats, ARRAY['lifetimeLosses'], 
                to_jsonb((v_stats->>'lifetimeLosses')::NUMERIC + p_amount));
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid transaction type: %', p_type;
    END IF;

    -- Update user balance and stats
    UPDATE public.users 
    SET cash = v_new_cash, stats = v_stats, updated_at = NOW()
    WHERE id = p_user_id;

    -- Create transaction record
    INSERT INTO public.transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (p_user_id, p_type, p_amount, v_new_cash, p_description, p_metadata)
    RETURNING id INTO v_transaction_id;

    RETURN QUERY SELECT v_new_cash, v_transaction_id;
END;
$$;

-- Fix update_game_stats to use ARRAY[] for jsonb_set path
CREATE OR REPLACE FUNCTION update_game_stats(
    p_user_id UUID,
    p_won BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.users
    SET stats = jsonb_set(
        jsonb_set(
            stats,
            ARRAY['gamesPlayed'],
            to_jsonb((stats->>'gamesPlayed')::INTEGER + 1)
        ),
        CASE WHEN p_won THEN ARRAY['wins'] ELSE ARRAY['losses'] END,
        to_jsonb(
            CASE WHEN p_won 
                THEN (stats->>'wins')::INTEGER + 1 
                ELSE (stats->>'losses')::INTEGER + 1 
            END
        )
    ),
    updated_at = NOW()
    WHERE id = p_user_id;
END;
$$;
