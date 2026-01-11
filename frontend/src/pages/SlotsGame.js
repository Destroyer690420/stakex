import React from 'react';
import Slots from '../components/games/Slots';

const SlotsGame = () => {
    return (
        <div style={{
            marginTop: '-1rem',
            marginLeft: '-12px',
            marginRight: '-12px',
            minHeight: 'calc(100vh - 60px)'
        }}>
            <Slots />
        </div>
    );
};

export default SlotsGame;
