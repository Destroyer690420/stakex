import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import api from '../services/api';
import toast, { Toaster } from 'react-hot-toast';
import './AdminDashboard.css';

const AdminDashboard = () => {
    const { user } = useContext(AuthContext);
    const [activeTab, setActiveTab] = useState('stats');

    // Stats State
    const [stats, setStats] = useState(null);

    // Users State
    const [users, setUsers] = useState([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });

    // Credit Form State
    const [creditForm, setCreditForm] = useState({ userId: '', username: '', amount: '', reason: '' });
    const [bulkAmount, setBulkAmount] = useState('');
    const [bulkReason, setBulkReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Transaction Feed State
    const [transactions, setTransactions] = useState([]);

    // User Details Modal
    const [selectedUser, setSelectedUser] = useState(null);
    const [userTransactions, setUserTransactions] = useState([]);

    // Fetch stats on mount
    useEffect(() => {
        fetchStats();
    }, []);

    // Fetch users when tab changes or search
    useEffect(() => {
        if (activeTab === 'users') {
            fetchUsers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, pagination.page, searchQuery]);

    // Fetch transactions when tab changes
    useEffect(() => {
        if (activeTab === 'logs') {
            fetchTransactions();
            subscribeToTransactions();
        }
    }, [activeTab]);

    const fetchStats = async () => {
        try {
            const response = await api.get('/admin/stats');
            if (response.data.success) {
                setStats(response.data.stats);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    const fetchUsers = async () => {
        setUsersLoading(true);
        try {
            const response = await api.get('/admin/users', {
                params: {
                    page: pagination.page,
                    limit: 15,
                    search: searchQuery
                }
            });
            if (response.data.success) {
                setUsers(response.data.users);
                setPagination(response.data.pagination);
            }
        } catch (error) {
            console.error('Error fetching users:', error);
            toast.error('Failed to load users');
        } finally {
            setUsersLoading(false);
        }
    };

    const fetchTransactions = async () => {
        try {
            const { data, error } = await supabase
                .from('transactions')
                .select('*, users(username)')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            setTransactions(data || []);
        } catch (error) {
            console.error('Error fetching transactions:', error);
        }
    };

    const subscribeToTransactions = () => {
        const channel = supabase
            .channel('admin_transactions')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'transactions' },
                (payload) => {
                    setTransactions(prev => [payload.new, ...prev].slice(0, 50));
                }
            )
            .subscribe();

        return () => supabase.removeChannel(channel);
    };

    const handleSearch = (e) => {
        setSearchQuery(e.target.value);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const handleAdjustCredit = async (e) => {
        e.preventDefault();
        if (!creditForm.userId || !creditForm.amount) {
            toast.error('Please fill in all required fields');
            return;
        }

        setSubmitting(true);
        try {
            const response = await api.post('/admin/credit', {
                userId: creditForm.userId,
                amount: parseFloat(creditForm.amount),
                reason: creditForm.reason || 'Admin adjustment'
            });

            if (response.data.success) {
                toast.success(response.data.message);
                setCreditForm({ userId: '', username: '', amount: '', reason: '' });
                fetchStats();
                if (activeTab === 'users') fetchUsers();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to adjust credit');
        } finally {
            setSubmitting(false);
        }
    };

    const handleBulkCredit = async () => {
        if (!bulkAmount || parseFloat(bulkAmount) === 0) {
            toast.error('Please enter a valid amount');
            return;
        }

        if (!window.confirm(`Are you sure you want to give $${bulkAmount} to ALL users?`)) {
            return;
        }

        setSubmitting(true);
        try {
            const response = await api.post('/admin/bulkcredit', {
                userIds: 'all',
                amount: parseFloat(bulkAmount),
                reason: bulkReason || 'Bulk admin credit'
            });

            if (response.data.success) {
                toast.success(response.data.message);
                setBulkAmount('');
                setBulkReason('');
                fetchStats();
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to process bulk credit');
        } finally {
            setSubmitting(false);
        }
    };

    const toggleAdminStatus = async (userId, currentStatus) => {
        try {
            const { error } = await supabase
                .from('users')
                .update({ is_admin: !currentStatus })
                .eq('id', userId);

            if (error) throw error;
            toast.success(`Admin status ${!currentStatus ? 'granted' : 'revoked'}`);
            fetchUsers();
        } catch (error) {
            toast.error('Failed to update admin status');
        }
    };

    const viewUserDetails = async (userId) => {
        try {
            const response = await api.get(`/admin/users/${userId}`);
            if (response.data.success) {
                setSelectedUser(response.data.user);
                setUserTransactions(response.data.recentTransactions);
            }
        } catch (error) {
            toast.error('Failed to load user details');
        }
    };

    const formatDate = (date) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatTime = (date) => {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getTransactionIcon = (type) => {
        return '';
    };

    return (
        <div className="admin-wrapper">
            <Toaster position="top-center" />

            {/* Sidebar */}
            <div className="admin-sidebar">
                <div className="sidebar-header">
                    <h1 className="sidebar-title">
                        Command Center
                    </h1>
                </div>
                <nav className="sidebar-nav">
                    <button
                        className={`nav-item ${activeTab === 'stats' ? 'active' : ''}`}
                        onClick={() => setActiveTab('stats')}
                    >
                        Dashboard
                    </button>
                    <button
                        className={`nav-item ${activeTab === 'users' ? 'active' : ''}`}
                        onClick={() => setActiveTab('users')}
                    >
                        Users
                    </button>
                    <button
                        className={`nav-item ${activeTab === 'credits' ? 'active' : ''}`}
                        onClick={() => setActiveTab('credits')}
                    >
                        Credits
                    </button>
                    <button
                        className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
                        onClick={() => setActiveTab('logs')}
                    >
                        Live Logs
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <div className="admin-content">
                {/* Stats Tab */}
                {activeTab === 'stats' && (
                    <>
                        <div className="content-header">
                            <h2 className="content-title">Platform Overview</h2>
                            <p className="content-subtitle">Real-time statistics and metrics</p>
                        </div>

                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-value">{stats?.totalUsers || 0}</div>
                                <div className="stat-label">Total Users</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{stats?.activeUsers || 0}</div>
                                <div className="stat-label">Active Users</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{stats?.newUsersToday || 0}</div>
                                <div className="stat-label">New Today</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">${stats?.totalCashInCirculation?.toLocaleString() || 0}</div>
                                <div className="stat-label">Coins in Circulation</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">${stats?.averageCash?.toLocaleString() || 0}</div>
                                <div className="stat-label">Avg Balance</div>
                            </div>
                        </div>
                    </>
                )}

                {/* Users Tab */}
                {activeTab === 'users' && (
                    <>
                        <div className="content-header">
                            <h2 className="content-title">User Management</h2>
                            <p className="content-subtitle">View and manage all platform users</p>
                        </div>

                        <div className="search-bar">
                            <input
                                type="text"
                                placeholder="Search by username or email..."
                                value={searchQuery}
                                onChange={handleSearch}
                            />
                        </div>

                        <div className="data-table-container">
                            {usersLoading ? (
                                <div className="loading-spinner"></div>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Email</th>
                                            <th className="mobile-hidden">Balance</th>
                                            <th className="mobile-hidden">Role</th>
                                            <th className="mobile-hidden">Joined</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(u => (
                                            <tr key={u.id}>
                                                <td><strong>{u.username}</strong></td>
                                                <td>{u.email}</td>
                                                <td className="mobile-hidden" style={{ color: '#d4af37', fontWeight: 600 }}>
                                                    ${parseFloat(u.cash).toFixed(2)}
                                                </td>
                                                <td className="mobile-hidden">
                                                    <span className={`badge ${u.is_admin ? 'badge-admin' : 'badge-user'}`}>
                                                        {u.is_admin ? 'Admin' : 'User'}
                                                    </span>
                                                </td>
                                                <td className="mobile-hidden">{formatDate(u.created_at)}</td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button
                                                            className="action-btn action-btn-secondary"
                                                            onClick={() => viewUserDetails(u.id)}
                                                        >
                                                            View
                                                        </button>
                                                        <button
                                                            className="action-btn action-btn-primary"
                                                            onClick={() => {
                                                                setCreditForm({
                                                                    userId: u.id,
                                                                    username: u.username,
                                                                    amount: '',
                                                                    reason: ''
                                                                });
                                                                setActiveTab('credits');
                                                            }}
                                                        >
                                                            Adjust
                                                        </button>
                                                        {u.id !== user.id && (
                                                            <button
                                                                className={`action-btn ${u.is_admin ? 'action-btn-danger' : 'action-btn-secondary'}`}
                                                                onClick={() => toggleAdminStatus(u.id, u.is_admin)}
                                                            >
                                                                {u.is_admin ? 'Revoke' : 'Make Admin'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {/* Pagination */}
                            {pagination.pages > 1 && (
                                <div className="pagination">
                                    <button
                                        className="page-btn"
                                        onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                                        disabled={pagination.page === 1}
                                    >
                                        Prev
                                    </button>
                                    <span style={{ color: '#7a8599' }}>
                                        Page {pagination.page} of {pagination.pages}
                                    </span>
                                    <button
                                        className="page-btn"
                                        onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                                        disabled={pagination.page === pagination.pages}
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {/* Credits Tab */}
                {activeTab === 'credits' && (
                    <>
                        <div className="content-header">
                            <h2 className="content-title">Credit Management</h2>
                            <p className="content-subtitle">Adjust user balances and run promotions</p>
                        </div>

                        {/* Individual Credit Adjustment */}
                        <div className="form-card">
                            <h3 className="form-title">
                                Individual Credit Adjustment
                            </h3>
                            <form onSubmit={handleAdjustCredit}>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">User {creditForm.userId && <span style={{ color: '#d4af37' }}>Found</span>}</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="Enter exact username..."
                                            value={creditForm.username}
                                            onChange={(e) => {
                                                setCreditForm(prev => ({ ...prev, username: e.target.value, userId: '' }));
                                            }}
                                            onBlur={async () => {
                                                if (creditForm.username && creditForm.username.length > 0) {
                                                    try {
                                                        const { data, error } = await supabase
                                                            .from('users')
                                                            .select('id, username')
                                                            .ilike('username', creditForm.username)
                                                            .maybeSingle();
                                                        if (data && !error) {
                                                            setCreditForm(prev => ({
                                                                ...prev,
                                                                userId: data.id,
                                                                username: data.username
                                                            }));
                                                            toast.success(`User found: ${data.username}`);
                                                        } else {
                                                            toast.error('User not found. Check RLS policies or try from Users tab.');
                                                        }
                                                    } catch (err) {
                                                        console.error('User lookup error:', err);
                                                        toast.error('Lookup failed: ' + err.message);
                                                    }
                                                }
                                            }}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Amount (+/-)</label>
                                        <input
                                            type="number"
                                            className="form-input"
                                            placeholder="e.g., 100 or -50"
                                            value={creditForm.amount}
                                            onChange={(e) => setCreditForm(prev => ({ ...prev, amount: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <div className="form-group" style={{ marginBottom: '16px' }}>
                                    <label className="form-label">Reason (Optional)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="Reason for adjustment..."
                                        value={creditForm.reason}
                                        onChange={(e) => setCreditForm(prev => ({ ...prev, reason: e.target.value }))}
                                    />
                                </div>
                                <button type="submit" className="form-submit" disabled={submitting}>
                                    {submitting ? 'Processing...' : 'Adjust Balance'}
                                </button>
                            </form>
                        </div>

                        {/* Bulk Credit */}
                        <div className="form-card">
                            <h3 className="form-title">
                                Bulk Credit (All Users)
                            </h3>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Amount</label>
                                    <input
                                        type="number"
                                        className="form-input"
                                        placeholder="Amount for all users..."
                                        value={bulkAmount}
                                        onChange={(e) => setBulkAmount(e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Reason (Optional)</label>
                                    <input
                                        type="text"
                                        className="form-input"
                                        placeholder="e.g., Holiday Bonus"
                                        value={bulkReason}
                                        onChange={(e) => setBulkReason(e.target.value)}
                                    />
                                </div>
                            </div>
                            <button
                                className="form-submit"
                                onClick={handleBulkCredit}
                                disabled={submitting}
                            >
                                {submitting ? 'Processing...' : 'Credit All Users'}
                            </button>
                        </div>
                    </>
                )}

                {/* Logs Tab */}
                {activeTab === 'logs' && (
                    <>
                        <div className="content-header">
                            <h2 className="content-title">Transaction Feed</h2>
                            <p className="content-subtitle">Real-time platform activity</p>
                        </div>

                        <div className="feed-container">
                            <div className="feed-header">
                                <span className="feed-title">Live Transactions</span>
                                <span className="live-indicator">
                                    <span className="live-dot"></span>
                                    Live
                                </span>
                            </div>
                            <div className="feed-list">
                                {transactions.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-text">No transactions yet</div>
                                    </div>
                                ) : (
                                    transactions.map(tx => (
                                        <div key={tx.id} className="feed-item">
                                            <div>
                                                {getTransactionIcon(tx.type)}
                                            </div>
                                            <div className="feed-details">
                                                <div className="feed-user">{tx.users?.username || 'Unknown'}</div>
                                                <div className="feed-game">{tx.description}</div>
                                            </div>
                                            <div>
                                                <div className={`feed-amount ${tx.type.includes('win') || tx.type.includes('grant') || tx.type.includes('credit') || tx.type.includes('bonus') ? 'positive' : 'negative'}`}>
                                                    {tx.type.includes('win') || tx.type.includes('grant') || tx.type.includes('credit') || tx.type.includes('bonus') ? '+' : '-'}${parseFloat(tx.amount).toFixed(2)}
                                                </div>
                                                <div className="feed-time">{formatTime(tx.created_at)}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* User Details Modal */}
            {selectedUser && (
                <div className="modal-overlay" onClick={() => setSelectedUser(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{selectedUser.username}</h3>
                            <button className="modal-close" onClick={() => setSelectedUser(null)}>×</button>
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <p style={{ color: '#7a8599', marginBottom: '8px' }}>Email: {selectedUser.email}</p>
                            <p style={{ color: '#d4af37', fontWeight: 700, fontSize: '24px' }}>
                                Balance: ${parseFloat(selectedUser.cash).toFixed(2)}
                            </p>
                            <p style={{ color: '#7a8599', fontSize: '13px' }}>
                                Games Played: {selectedUser.stats?.gamesPlayed || 0} |
                                Wins: {selectedUser.stats?.wins || 0} |
                                Losses: {selectedUser.stats?.losses || 0}
                            </p>
                        </div>
                        <h4 style={{ color: '#fff', marginBottom: '12px' }}>Recent Transactions</h4>
                        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {userTransactions.map(tx => (
                                <div key={tx.id} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    padding: '10px 0',
                                    borderBottom: '1px solid rgba(255,255,255,0.05)'
                                }}>
                                    <span style={{ color: '#7a8599', fontSize: '13px' }}>{tx.description}</span>
                                    <span style={{
                                        color: tx.type.includes('win') || tx.type.includes('grant') ? '#d4af37' : '#ff4757',
                                        fontWeight: 600
                                    }}>
                                        {tx.type.includes('win') || tx.type.includes('grant') ? '+' : '-'}${tx.amount}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
