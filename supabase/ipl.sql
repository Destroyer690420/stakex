-- ============================================
-- IPL BETTING - StakeX
-- Supabase Migration
-- ============================================

-- IPL Bets Table
CREATE TABLE IF NOT EXISTS ipl_bets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id text NOT NULL,
    match_title text NOT NULL,
    selected_team text NOT NULL,
    bet_amount numeric(12,2) NOT NULL CHECK (bet_amount >= 10 AND bet_amount <= 10000),
    odds_at_placement numeric(5,2) NOT NULL CHECK (odds_at_placement >= 1.10 AND odds_at_placement <= 6.50),
    potential_payout numeric(12,2) NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'refunded')),
    settled_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ipl_bets_user_id ON ipl_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_ipl_bets_match_id ON ipl_bets(match_id);
CREATE INDEX IF NOT EXISTS idx_ipl_bets_status ON ipl_bets(status);
CREATE INDEX IF NOT EXISTS idx_ipl_bets_match_status ON ipl_bets(match_id, status);

-- ============================================
-- RPC: Place IPL Bet (atomic transaction)
-- Deducts balance + inserts bet + records transaction
-- ============================================
CREATE OR REPLACE FUNCTION place_ipl_bet(
    p_user_id uuid,
    p_match_id text,
    p_match_title text,
    p_selected_team text,
    p_bet_amount numeric,
    p_odds numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_cash numeric;
    v_potential_payout numeric;
    v_bet_id uuid;
    v_new_balance numeric;
BEGIN
    -- Lock user row to prevent race conditions
    SELECT cash INTO v_user_cash FROM users WHERE id = p_user_id FOR UPDATE;

    IF v_user_cash IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    IF p_bet_amount < 10 OR p_bet_amount > 10000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bet must be between $10 and $10,000');
    END IF;

    IF v_user_cash < p_bet_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;

    v_potential_payout := ROUND(p_bet_amount * p_odds, 2);

    -- Deduct balance
    UPDATE users SET cash = cash - p_bet_amount WHERE id = p_user_id
    RETURNING cash INTO v_new_balance;

    -- Insert bet record
    INSERT INTO ipl_bets (user_id, match_id, match_title, selected_team, bet_amount, odds_at_placement, potential_payout)
    VALUES (p_user_id, p_match_id, p_match_title, p_selected_team, p_bet_amount, p_odds, v_potential_payout)
    RETURNING id INTO v_bet_id;

    -- Record transaction
    INSERT INTO transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (
        p_user_id,
        'bet',
        p_bet_amount,
        v_new_balance,
        'IPL Bet: ' || p_selected_team || ' - ' || p_match_title,
        jsonb_build_object(
            'game', 'ipl',
            'match_id', p_match_id,
            'team', p_selected_team,
            'odds', p_odds,
            'potential_payout', v_potential_payout
        )
    );

    -- Get new balance
    SELECT cash INTO v_new_balance FROM users WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'bet_id', v_bet_id,
        'new_balance', v_new_balance,
        'potential_payout', v_potential_payout
    );
END;
$$;

-- ============================================
-- RPC: Settle IPL Bet (atomic settlement)
-- Credits winner or marks loser
-- ============================================
CREATE OR REPLACE FUNCTION settle_ipl_bet(
    p_bet_id uuid,
    p_won boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_bet RECORD;
    v_new_balance numeric;
BEGIN
    -- Lock and get bet
    SELECT * INTO v_bet FROM ipl_bets WHERE id = p_bet_id AND status = 'pending' FOR UPDATE;

    IF v_bet IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bet not found or already settled');
    END IF;

    IF p_won THEN
        -- Credit the winner
        UPDATE users SET cash = cash + v_bet.potential_payout WHERE id = v_bet.user_id
        RETURNING cash INTO v_new_balance;

        -- Update bet status
        UPDATE ipl_bets SET status = 'won', settled_at = now() WHERE id = p_bet_id;

        -- Record win transaction
        INSERT INTO transactions (user_id, type, amount, balance_after, description, metadata)
        VALUES (
            v_bet.user_id,
            'win',
            v_bet.potential_payout,
            v_new_balance,
            'IPL Win: ' || v_bet.selected_team || ' - ' || v_bet.match_title,
            jsonb_build_object(
                'game', 'ipl',
                'match_id', v_bet.match_id,
                'team', v_bet.selected_team,
                'odds', v_bet.odds_at_placement,
                'bet_amount', v_bet.bet_amount,
                'payout', v_bet.potential_payout
            )
        );

        SELECT cash INTO v_new_balance FROM users WHERE id = v_bet.user_id;
    ELSE
        -- Mark as lost (money already deducted at placement)
        UPDATE ipl_bets SET status = 'lost', settled_at = now() WHERE id = p_bet_id;
        v_new_balance := 0;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'won', p_won,
        'payout', CASE WHEN p_won THEN v_bet.potential_payout ELSE 0 END,
        'new_balance', v_new_balance,
        'user_id', v_bet.user_id
    );
END;
$$;
