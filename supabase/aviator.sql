-- ========================================
-- AVIATOR (CRASH) GAME SCHEMA
-- Run this in Supabase SQL Editor
-- ========================================

-- ========================================
-- CRASH ROUNDS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS public.crash_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    crash_point NUMERIC(10, 2) NOT NULL CHECK (crash_point >= 1.00),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'flying', 'crashed')),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    hash TEXT NOT NULL,
    server_seed TEXT,
    client_seed TEXT DEFAULT 'stakex_public_seed',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_crash_rounds_status ON public.crash_rounds(status);
CREATE INDEX IF NOT EXISTS idx_crash_rounds_created ON public.crash_rounds(created_at DESC);

-- ========================================
-- CRASH BETS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS public.crash_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES public.crash_rounds(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    bet_number INTEGER NOT NULL DEFAULT 1 CHECK (bet_number IN (1, 2)),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    auto_cashout NUMERIC(10, 2) DEFAULT NULL,
    cashout_multiplier NUMERIC(10, 2) DEFAULT NULL,
    profit NUMERIC DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cashed_out', 'lost')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Prevent duplicate bets per round per bet slot
    CONSTRAINT unique_user_round_bet UNIQUE (round_id, user_id, bet_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crash_bets_round ON public.crash_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_crash_bets_user ON public.crash_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_crash_bets_status ON public.crash_bets(status);

-- ========================================
-- ROW LEVEL SECURITY
-- ========================================

ALTER TABLE public.crash_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crash_bets ENABLE ROW LEVEL SECURITY;

-- Everyone can view rounds
CREATE POLICY "Anyone can view crash rounds" ON public.crash_rounds
    FOR SELECT USING (true);

-- Only server can insert/update rounds (via service role)
CREATE POLICY "Service can manage rounds" ON public.crash_rounds
    FOR ALL USING (true) WITH CHECK (true);

-- Users can view all bets (for live feed)
CREATE POLICY "Anyone can view crash bets" ON public.crash_bets
    FOR SELECT USING (true);

-- Users can insert their own bets
CREATE POLICY "Users can place bets" ON public.crash_bets
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service can update bets
CREATE POLICY "Service can update bets" ON public.crash_bets
    FOR UPDATE USING (true) WITH CHECK (true);

-- ========================================
-- PLACE CRASH BET FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION fn_place_crash_bet(
    p_user_id UUID,
    p_round_id UUID,
    p_amount NUMERIC,
    p_bet_number INTEGER DEFAULT 1,
    p_auto_cashout NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_user_cash NUMERIC;
    v_round_status TEXT;
    v_bet_id UUID;
BEGIN
    -- Check round status
    SELECT status INTO v_round_status
    FROM public.crash_rounds
    WHERE id = p_round_id;
    
    IF v_round_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Round not found');
    END IF;
    
    IF v_round_status != 'waiting' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Round already started');
    END IF;
    
    -- Check user balance
    SELECT cash INTO v_user_cash
    FROM public.users
    WHERE id = p_user_id
    FOR UPDATE;
    
    IF v_user_cash IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;
    
    IF v_user_cash < p_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
    END IF;
    
    -- Check for existing bet in this slot
    IF EXISTS (
        SELECT 1 FROM public.crash_bets 
        WHERE round_id = p_round_id 
        AND user_id = p_user_id 
        AND bet_number = p_bet_number
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already placed bet in this slot');
    END IF;
    
    -- Deduct balance
    UPDATE public.users
    SET cash = cash - p_amount, updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Create bet
    INSERT INTO public.crash_bets (round_id, user_id, bet_number, amount, auto_cashout)
    VALUES (p_round_id, p_user_id, p_bet_number, p_amount, p_auto_cashout)
    RETURNING id INTO v_bet_id;
    
    RETURN jsonb_build_object(
        'success', true, 
        'bet_id', v_bet_id,
        'new_balance', v_user_cash - p_amount
    );
END;
$$;

-- ========================================
-- CASH OUT FUNCTION
-- ========================================

CREATE OR REPLACE FUNCTION fn_cash_out_crash(
    p_user_id UUID,
    p_round_id UUID,
    p_multiplier NUMERIC,
    p_bet_number INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_bet RECORD;
    v_profit NUMERIC;
    v_payout NUMERIC;
BEGIN
    -- Get active bet
    SELECT * INTO v_bet
    FROM public.crash_bets
    WHERE round_id = p_round_id
    AND user_id = p_user_id
    AND bet_number = p_bet_number
    AND status = 'active'
    FOR UPDATE;
    
    IF v_bet IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active bet found');
    END IF;
    
    -- Calculate profit
    v_payout := v_bet.amount * p_multiplier;
    v_profit := v_payout - v_bet.amount;
    
    -- Update bet
    UPDATE public.crash_bets
    SET status = 'cashed_out',
        cashout_multiplier = p_multiplier,
        profit = v_profit
    WHERE id = v_bet.id;
    
    -- Credit user
    UPDATE public.users
    SET cash = cash + v_payout, updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Update stats
    PERFORM update_game_stats(p_user_id, true);
    
    RETURN jsonb_build_object(
        'success', true,
        'multiplier', p_multiplier,
        'profit', v_profit,
        'payout', v_payout
    );
END;
$$;

-- ========================================
-- SETTLE ROUND (MARK LOSERS)
-- ========================================

CREATE OR REPLACE FUNCTION fn_settle_crash_round(p_round_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_lost_count INTEGER;
BEGIN
    -- Mark all remaining active bets as lost
    UPDATE public.crash_bets
    SET status = 'lost', profit = -amount
    WHERE round_id = p_round_id AND status = 'active';
    
    GET DIAGNOSTICS v_lost_count = ROW_COUNT;
    
    -- Update stats for losers
    UPDATE public.users u
    SET stats = jsonb_set(
        jsonb_set(stats, '{gamesPlayed}', to_jsonb((stats->>'gamesPlayed')::INTEGER + 1)),
        '{losses}', to_jsonb((stats->>'losses')::INTEGER + 1)
    )
    WHERE u.id IN (
        SELECT user_id FROM public.crash_bets 
        WHERE round_id = p_round_id AND status = 'lost'
    );
    
    RETURN v_lost_count;
END;
$$;

-- ========================================
-- GET CURRENT ROUND
-- ========================================

CREATE OR REPLACE FUNCTION fn_get_current_crash_round()
RETURNS TABLE (
    id UUID,
    crash_point NUMERIC,
    status TEXT,
    start_time TIMESTAMPTZ,
    hash TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT r.id, r.crash_point, r.status, r.start_time, r.hash
    FROM public.crash_rounds r
    WHERE r.status IN ('waiting', 'flying')
    ORDER BY r.created_at DESC
    LIMIT 1;
END;
$$;

-- ========================================
-- GET ROUND HISTORY
-- ========================================

CREATE OR REPLACE FUNCTION fn_get_crash_history(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
    id UUID,
    crash_point NUMERIC,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT r.id, r.crash_point, r.created_at
    FROM public.crash_rounds r
    WHERE r.status = 'crashed'
    ORDER BY r.created_at DESC
    LIMIT p_limit;
END;
$$;
