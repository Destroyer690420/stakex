import React from 'react';
import ProfileComponent from '../components/Profile';

const Profile = () => {
    return (
        <div className="container py-4">
            <h2 className="text-white mb-4">👤 My Profile</h2>
            <ProfileComponent showTransactions={true} />
        </div>
    );
};

export default Profile;
