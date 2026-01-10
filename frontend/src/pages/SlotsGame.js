import React from 'react';
import Slots from '../components/games/Slots';

const SlotsGame = () => {
    return (
        <div className="container py-5">
            <h2 className="text-white mb-4 text-center">🎰 Mystic Slots</h2>
            <div className="card p-5" style={{ minHeight: '500px' }}>
                <Slots />
            </div>
        </div>
    );
};

export default SlotsGame;
