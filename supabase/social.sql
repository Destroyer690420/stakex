-- ========================================
-- STAKEX SOCIAL FEATURES SCHEMA
-- Run this in Supabase SQL Editor
-- ========================================

-- ========================================
-- FRIENDSHIPS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Prevent duplicate friendships and self-friending
    CONSTRAINT unique_friendship UNIQUE (requester_id, receiver_id),
    CONSTRAINT no_self_friendship CHECK (requester_id != receiver_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON public.friendships(receiver_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON public.friendships(status);

-- ========================================
-- ROW LEVEL SECURITY FOR FRIENDSHIPS
-- ========================================

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can view friendships where they are involved
CREATE POLICY "Users can view own friendships" ON public.friendships
    FOR SELECT USING (
        auth.uid() = requester_id OR auth.uid() = receiver_id
    );

-- Authenticated users can send friend requests
CREATE POLICY "Users can send friend requests" ON public.friendships
    FOR INSERT WITH CHECK (
        auth.uid() = requester_id
    );

-- Only receiver can update status (accept request)
CREATE POLICY "Receiver can update friendship status" ON public.friendships
    FOR UPDATE USING (
        auth.uid() = receiver_id
    ) WITH CHECK (
        auth.uid() = receiver_id
    );

-- Either party can delete (unfriend or decline)
CREATE POLICY "Users can delete own friendships" ON public.friendships
    FOR DELETE USING (
        auth.uid() = requester_id OR auth.uid() = receiver_id
    );

-- ========================================
-- LEADERBOARD VIEW
-- ========================================

CREATE OR REPLACE VIEW public.leaderboard AS
SELECT 
    id,
    username,
    avatar,
    cash,
    (stats->>'wins')::INTEGER AS wins,
    (stats->>'gamesPlayed')::INTEGER AS games_played
FROM public.users
WHERE is_active = true
ORDER BY cash DESC
LIMIT 100;

-- Grant access to the view
GRANT SELECT ON public.leaderboard TO authenticated;
GRANT SELECT ON public.leaderboard TO anon;

-- ========================================
-- USER SEARCH FUNCTION (RPC)
-- ========================================

CREATE OR REPLACE FUNCTION fn_search_users(
    p_query TEXT,
    p_current_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    username TEXT,
    avatar TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.username, u.avatar
    FROM public.users u
    WHERE 
        u.username ILIKE '%' || p_query || '%'
        AND u.is_active = true
        AND (p_current_user_id IS NULL OR u.id != p_current_user_id)
    ORDER BY u.username
    LIMIT 20;
END;
$$;

-- ========================================
-- GET FRIENDS FUNCTION (RPC)
-- ========================================

CREATE OR REPLACE FUNCTION fn_get_friends(p_user_id UUID)
RETURNS TABLE (
    friendship_id UUID,
    friend_id UUID,
    friend_username TEXT,
    friend_avatar TEXT,
    status TEXT,
    is_requester BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        f.id AS friendship_id,
        CASE 
            WHEN f.requester_id = p_user_id THEN f.receiver_id 
            ELSE f.requester_id 
        END AS friend_id,
        u.username AS friend_username,
        u.avatar AS friend_avatar,
        f.status,
        (f.requester_id = p_user_id) AS is_requester,
        f.created_at
    FROM public.friendships f
    JOIN public.users u ON u.id = CASE 
        WHEN f.requester_id = p_user_id THEN f.receiver_id 
        ELSE f.requester_id 
    END
    WHERE f.requester_id = p_user_id OR f.receiver_id = p_user_id
    ORDER BY f.status ASC, f.created_at DESC;
END;
$$;

-- ========================================
-- ACCEPT FRIEND REQUEST FUNCTION (RPC)
-- ========================================

CREATE OR REPLACE FUNCTION fn_accept_friend_request(p_friendship_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_receiver_id UUID;
BEGIN
    -- Get the receiver_id and verify current user is the receiver
    SELECT receiver_id INTO v_receiver_id
    FROM public.friendships
    WHERE id = p_friendship_id AND status = 'pending';
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Friend request not found');
    END IF;
    
    IF v_receiver_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
    END IF;
    
    -- Update status to accepted
    UPDATE public.friendships
    SET status = 'accepted', updated_at = NOW()
    WHERE id = p_friendship_id;
    
    RETURN jsonb_build_object('success', true, 'message', 'Friend request accepted');
END;
$$;

-- ========================================
-- POLICY UPDATE: Allow users to view other users for leaderboard/friends
-- ========================================

-- Drop existing restrictive policy if exists
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;

-- Create new policy allowing users to view basic info of all active users
CREATE POLICY "Users can view all profiles" ON public.users
    FOR SELECT USING (is_active = true);

-- Keep update restricted to own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
