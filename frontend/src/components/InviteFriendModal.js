import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import toast from 'react-hot-toast';
import './InviteFriendModal.css';

const InviteFriendModal = ({ isOpen, onClose, gameType, roomId }) => {
    const { user } = useContext(AuthContext);
    const [friends, setFriends] = useState([]);
    const [loading, setLoading] = useState(true);
    const [inviting, setInviting] = useState(null);

    useEffect(() => {
        if (isOpen && user?.id) {
            fetchFriends();
        }
    }, [isOpen, user]);

    const fetchFriends = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase.rpc('fn_get_friends', {
                p_user_id: user.id
            });

            if (error) throw error;

            // Only show accepted friends
            const acceptedFriends = data.filter(f => f.status === 'accepted');
            setFriends(acceptedFriends);
        } catch (error) {
            console.error('Error fetching friends:', error);
        } finally {
            setLoading(false);
        }
    };

    const sendInvite = async (friendId, friendUsername) => {
        try {
            setInviting(friendId);

            // Create a channel for the friend and broadcast invite
            const channel = supabase.channel(`user-invites:${friendId}`);

            await channel.subscribe();

            await channel.send({
                type: 'broadcast',
                event: 'game-invite',
                payload: {
                    roomId: roomId,
                    gameType: gameType,
                    inviterName: user.username,
                    inviterId: user.id
                }
            });

            // Cleanup channel after sending
            await supabase.removeChannel(channel);

            toast.success(`Invite sent to ${friendUsername}!`);
        } catch (error) {
            console.error('Error sending invite:', error);
            toast.error('Failed to send invite');
        } finally {
            setInviting(null);
        }
    };

    const getInitials = (username) => {
        return username ? username.substring(0, 2).toUpperCase() : '??';
    };

    if (!isOpen) return null;

    return (
        <div className="invite-modal-overlay" onClick={onClose}>
            <div className="invite-modal" onClick={e => e.stopPropagation()}>
                <div className="invite-modal-header">
                    <h2>Invite Friends</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="invite-modal-content">
                    {loading ? (
                        <div className="invite-loading">Loading friends...</div>
                    ) : friends.length === 0 ? (
                        <div className="invite-empty">
                            <span className="empty-icon">😔</span>
                            <p>No friends to invite yet</p>
                            <p className="hint">Add some friends first!</p>
                        </div>
                    ) : (
                        <div className="friends-invite-list">
                            {friends.map(friend => (
                                <div key={friend.friendship_id} className="invite-friend-card">
                                    <div className="invite-friend-avatar">
                                        {getInitials(friend.friend_username)}
                                    </div>
                                    <span className="invite-friend-name">
                                        {friend.friend_username}
                                    </span>
                                    <button
                                        className="invite-btn"
                                        onClick={() => sendInvite(friend.friend_id, friend.friend_username)}
                                        disabled={inviting === friend.friend_id}
                                    >
                                        {inviting === friend.friend_id ? 'Sending...' : 'Invite'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InviteFriendModal;
