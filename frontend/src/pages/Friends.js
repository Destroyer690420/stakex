import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import toast from 'react-hot-toast';
import './Friends.css';

const Friends = () => {
    const { user } = useContext(AuthContext);
    const [activeTab, setActiveTab] = useState('friends');
    const [friends, setFriends] = useState([]);
    const [pendingRequests, setPendingRequests] = useState([]);
    const [sentRequests, setSentRequests] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (user?.id) {
            fetchFriends();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const fetchFriends = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase.rpc('fn_get_friends', {
                p_user_id: user.id
            });

            if (error) throw error;

            // Separate into categories
            const accepted = data.filter(f => f.status === 'accepted');
            const pending = data.filter(f => f.status === 'pending' && !f.is_requester);
            const sent = data.filter(f => f.status === 'pending' && f.is_requester);

            setFriends(accepted);
            setPendingRequests(pending);
            setSentRequests(sent);
        } catch (error) {
            console.error('Error fetching friends:', error);
            toast.error('Failed to load friends');
        } finally {
            setLoading(false);
        }
    };

    const searchUsers = async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        try {
            setSearching(true);
            const { data, error } = await supabase.rpc('fn_search_users', {
                p_query: searchQuery,
                p_current_user_id: user.id
            });

            if (error) throw error;

            // Filter out existing friends and pending requests
            const existingIds = [...friends, ...pendingRequests, ...sentRequests].map(f => f.friend_id);
            const filtered = data.filter(u => !existingIds.includes(u.id));
            setSearchResults(filtered);
        } catch (error) {
            console.error('Error searching users:', error);
            toast.error('Search failed');
        } finally {
            setSearching(false);
        }
    };

    const sendFriendRequest = async (receiverId, username) => {
        try {
            const { error } = await supabase
                .from('friendships')
                .insert({
                    requester_id: user.id,
                    receiver_id: receiverId
                });

            if (error) {
                if (error.code === '23505') {
                    toast.error('Friend request already sent');
                } else {
                    throw error;
                }
                return;
            }

            toast.success(`Friend request sent to ${username}!`);
            setSearchResults(prev => prev.filter(u => u.id !== receiverId));
            fetchFriends();
        } catch (error) {
            console.error('Error sending friend request:', error);
            toast.error('Failed to send request');
        }
    };

    const acceptRequest = async (friendshipId, username) => {
        try {
            const { data, error } = await supabase.rpc('fn_accept_friend_request', {
                p_friendship_id: friendshipId
            });

            if (error) throw error;

            if (data.success) {
                toast.success(`You are now friends with ${username}!`);
                fetchFriends();
            } else {
                toast.error(data.error);
            }
        } catch (error) {
            console.error('Error accepting request:', error);
            toast.error('Failed to accept request');
        }
    };

    const declineOrRemove = async (friendshipId, action = 'remove') => {
        try {
            const { error } = await supabase
                .from('friendships')
                .delete()
                .eq('id', friendshipId);

            if (error) throw error;

            toast.success(action === 'decline' ? 'Request declined' : 'Friend removed');
            fetchFriends();
        } catch (error) {
            console.error('Error:', error);
            toast.error('Operation failed');
        }
    };

    const getInitials = (username) => {
        return username ? username.substring(0, 2).toUpperCase() : '??';
    };

    return (
        <div className="friends-wrapper">
            <div className="friends-container">
                <div className="friends-header">
                    <h1>👥 Friends</h1>
                    <p className="friends-subtitle">Connect with other players</p>
                </div>

                {/* Tabs */}
                <div className="friends-tabs">
                    <button
                        className={`tab-btn ${activeTab === 'friends' ? 'active' : ''}`}
                        onClick={() => setActiveTab('friends')}
                    >
                        My Friends
                        {friends.length > 0 && <span className="tab-badge">{friends.length}</span>}
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
                        onClick={() => setActiveTab('pending')}
                    >
                        Pending
                        {pendingRequests.length > 0 && (
                            <span className="tab-badge pending">{pendingRequests.length}</span>
                        )}
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'add' ? 'active' : ''}`}
                        onClick={() => setActiveTab('add')}
                    >
                        Add Friend
                    </button>
                </div>

                {/* Tab Content */}
                <div className="tab-content">
                    {/* My Friends Tab */}
                    {activeTab === 'friends' && (
                        <div className="friends-list">
                            {loading ? (
                                <div className="loading-state">Loading friends...</div>
                            ) : friends.length === 0 ? (
                                <div className="empty-state">
                                    <span className="empty-icon">😔</span>
                                    <p>No friends yet</p>
                                    <button
                                        className="add-friend-btn"
                                        onClick={() => setActiveTab('add')}
                                    >
                                        Add Your First Friend
                                    </button>
                                </div>
                            ) : (
                                friends.map(friend => (
                                    <div key={friend.friendship_id} className="friend-card">
                                        <div className="friend-avatar">
                                            {getInitials(friend.friend_username)}
                                        </div>
                                        <div className="friend-info">
                                            <span className="friend-name">{friend.friend_username}</span>
                                            <span className="friend-status online">Friend</span>
                                        </div>
                                        <div className="friend-actions">
                                            <button
                                                className="action-btn remove"
                                                onClick={() => declineOrRemove(friend.friendship_id)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* Pending Requests Tab */}
                    {activeTab === 'pending' && (
                        <div className="pending-section">
                            <h3>Incoming Requests</h3>
                            {pendingRequests.length === 0 ? (
                                <div className="empty-state small">
                                    <p>No pending requests</p>
                                </div>
                            ) : (
                                <div className="friends-list">
                                    {pendingRequests.map(request => (
                                        <div key={request.friendship_id} className="friend-card">
                                            <div className="friend-avatar pending">
                                                {getInitials(request.friend_username)}
                                            </div>
                                            <div className="friend-info">
                                                <span className="friend-name">{request.friend_username}</span>
                                                <span className="friend-status">Wants to be friends</span>
                                            </div>
                                            <div className="friend-actions">
                                                <button
                                                    className="action-btn accept"
                                                    onClick={() => acceptRequest(request.friendship_id, request.friend_username)}
                                                >
                                                    Accept
                                                </button>
                                                <button
                                                    className="action-btn decline"
                                                    onClick={() => declineOrRemove(request.friendship_id, 'decline')}
                                                >
                                                    Decline
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <h3>Sent Requests</h3>
                            {sentRequests.length === 0 ? (
                                <div className="empty-state small">
                                    <p>No sent requests</p>
                                </div>
                            ) : (
                                <div className="friends-list">
                                    {sentRequests.map(request => (
                                        <div key={request.friendship_id} className="friend-card">
                                            <div className="friend-avatar">
                                                {getInitials(request.friend_username)}
                                            </div>
                                            <div className="friend-info">
                                                <span className="friend-name">{request.friend_username}</span>
                                                <span className="friend-status">Request sent</span>
                                            </div>
                                            <div className="friend-actions">
                                                <button
                                                    className="action-btn cancel"
                                                    onClick={() => declineOrRemove(request.friendship_id)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Add Friend Tab */}
                    {activeTab === 'add' && (
                        <div className="add-friend-section">
                            <div className="search-box">
                                <input
                                    type="text"
                                    placeholder="Search by username..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                                />
                                <button
                                    className="search-btn"
                                    onClick={searchUsers}
                                    disabled={searching}
                                >
                                    {searching ? '...' : '🔍'}
                                </button>
                            </div>

                            <div className="search-results">
                                {searchResults.length === 0 && searchQuery && !searching ? (
                                    <div className="empty-state small">
                                        <p>No users found</p>
                                    </div>
                                ) : (
                                    searchResults.map(result => (
                                        <div key={result.id} className="friend-card">
                                            <div className="friend-avatar">
                                                {getInitials(result.username)}
                                            </div>
                                            <div className="friend-info">
                                                <span className="friend-name">{result.username}</span>
                                            </div>
                                            <div className="friend-actions">
                                                <button
                                                    className="action-btn add"
                                                    onClick={() => sendFriendRequest(result.id, result.username)}
                                                >
                                                    Add Friend
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Friends;
