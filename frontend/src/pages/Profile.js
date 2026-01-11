import React from 'react';
import ProfileComponent from '../components/Profile';

const Profile = () => {
    return (
        <div className="profile-page-wrapper">
            <h2 className="page-title">My Profile</h2>
            <ProfileComponent showTransactions={true} />
        </div>
    );
};

export default Profile;
