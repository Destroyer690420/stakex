-- ========================================
-- STAKEX DATABASE SCHEMA FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ========================================

-- Users Table (synced with auth.users via trigger)
CREATE TABLE public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    cash NUMERIC DEFAULT 1000 NOT NULL CHECK (cash >= 0),
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    avatar TEXT DEFAULT 'default-avatar.png',
    stats JSONB DEFAULT '{
        "gamesPlayed": 0,
        "wins": 0,
        "losses": 0,
        "biggestWin": 0,
        "lifetimeEarnings": 0,
        "lifetimeLosses": 0
    }'::jsonb NOT NULL,
    last_login TIMESTAMPTZ DEFAULT NOW(),
    last_bonus_claim TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Transactions Table
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'admin_grant', 'admin_deduct', 'game_win', 'game_loss', 'bonus', 'bet', 'win', 'loss')),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    balance_after NUMERIC NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Game Sessions Table
CREATE TABLE public.game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_type TEXT NOT NULL CHECK (game_type IN ('slots', 'poker', 'coinflip', 'roulette')),
    room_id TEXT,
    players JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'active' CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
    result JSONB,
    bets JSONB DEFAULT '[]'::jsonb,
    state_json JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX idx_game_sessions_room_id ON public.game_sessions(room_id);
CREATE INDEX idx_game_sessions_status ON public.game_sessions(status);
CREATE INDEX idx_users_username ON public.users(username);

-- ========================================
-- POSTGRES FUNCTIONS FOR ATOMIC OPERATIONS
-- ========================================

-- Function: Process a transaction atomically
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
            v_stats := jsonb_set(v_stats, '{lifetimeEarnings}', 
                to_jsonb((v_stats->>'lifetimeEarnings')::NUMERIC + p_amount));
            IF p_amount > (v_stats->>'biggestWin')::NUMERIC THEN
                v_stats := jsonb_set(v_stats, '{biggestWin}', to_jsonb(p_amount));
            END IF;
        END IF;
    ELSIF p_type IN ('debit', 'admin_deduct', 'game_loss', 'bet', 'loss') THEN
        IF v_current_cash < p_amount THEN
            RAISE EXCEPTION 'Insufficient balance';
        END IF;
        v_new_cash := v_current_cash - p_amount;
        
        -- Update stats for losses
        IF p_type IN ('game_loss', 'loss') THEN
            v_stats := jsonb_set(v_stats, '{lifetimeLosses}', 
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

-- Function: Claim daily bonus
CREATE OR REPLACE FUNCTION claim_daily_bonus(
    p_user_id UUID,
    p_bonus_amount NUMERIC DEFAULT 100,
    p_cooldown_hours INTEGER DEFAULT 24
) RETURNS TABLE(success BOOLEAN, message TEXT, new_balance NUMERIC, transaction_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_last_claim TIMESTAMPTZ;
    v_hours_since_claim NUMERIC;
    v_result RECORD;
BEGIN
    -- Get last bonus claim
    SELECT last_bonus_claim INTO v_last_claim
    FROM public.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'User not found'::TEXT, 0::NUMERIC, NULL::UUID;
        RETURN;
    END IF;

    -- Check cooldown
    IF v_last_claim IS NOT NULL THEN
        v_hours_since_claim := EXTRACT(EPOCH FROM (NOW() - v_last_claim)) / 3600;
        IF v_hours_since_claim < p_cooldown_hours THEN
            RETURN QUERY SELECT FALSE, 
                format('Daily bonus already claimed. Come back in %s hour(s)!', 
                    CEIL(p_cooldown_hours - v_hours_since_claim))::TEXT, 
                0::NUMERIC, NULL::UUID;
            RETURN;
        END IF;
    END IF;

    -- Process bonus transaction
    SELECT * INTO v_result FROM process_transaction(
        p_user_id, 'bonus', p_bonus_amount, 'Daily login bonus claimed!'
    );

    -- Update last bonus claim
    UPDATE public.users SET last_bonus_claim = NOW() WHERE id = p_user_id;

    RETURN QUERY SELECT TRUE, format('Daily bonus of $%s claimed!', p_bonus_amount)::TEXT, 
        v_result.new_balance, v_result.transaction_id;
END;
$$;

-- Function: Update game stats
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
            '{gamesPlayed}',
            to_jsonb((stats->>'gamesPlayed')::INTEGER + 1)
        ),
        CASE WHEN p_won THEN '{wins}' ELSE '{losses}' END,
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

-- ========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;

-- Users: Users can read/update their own row
CREATE POLICY "Users can view own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Transactions: Users can view their own transactions
CREATE POLICY "Users can view own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);

-- Game Sessions: Users can view sessions they're part of
CREATE POLICY "Users can view game sessions" ON public.game_sessions
    FOR SELECT USING (true);

CREATE POLICY "Users can insert game sessions" ON public.game_sessions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update game sessions" ON public.game_sessions
    FOR UPDATE USING (true);

-- ========================================
-- TRIGGER: Create user profile on signup
-- ========================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.users (id, username, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
        NEW.email
    );
    RETURN NEW;
END;
$$;

-- Drop if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
