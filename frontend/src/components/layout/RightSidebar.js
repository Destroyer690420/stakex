import React, { useState } from 'react';
import './RightSidebar.css';

const RightSidebar = ({ isOpen }) => {
    const [activeTab, setActiveTab] = useState('chat');

    return (
        <aside className={`right-sidebar ${isOpen ? 'open' : ''}`}>
            {/* Header Tabs */}
            <div className="chat-header">
                <div
                    className={`chat-tab ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chat')}
                >
                    Chat
                </div>
                <div
                    className={`chat-tab ${activeTab === 'bets' ? 'active' : ''}`}
                    onClick={() => setActiveTab('bets')}
                >
                    Live Bets
                </div>
            </div>

            {/* Chat Content */}
            {activeTab === 'chat' && (
                <div className="chat-content-wrapper">
                    <div className="chat-messages">
                        {/* Fake Chat Messages for Demo */}
                        <div className="chat-message">
                            <div className="chat-avatar">🐉</div>
                            <div className="message-content">
                                <div className="message-header">
                                    <span className="chat-username">DragonSlayer</span>
                                    <span className="chat-level">Lvl 24</span>
                                </div>
                                <div className="message-text">Anyone seen the new Dice game? It's 🔥</div>
                            </div>
                        </div>

                        <div className="chat-message">
                            <div className="chat-avatar">🦊</div>
                            <div className="message-content">
                                <div className="message-header">
                                    <span className="chat-username">CryptoFox</span>
                                    <span className="chat-level">Lvl 56</span>
                                </div>
                                <div className="message-text">Just hit a 50x on Aviator! 🚀</div>
                            </div>
                        </div>

                        <div className="chat-message">
                            <div className="chat-avatar">💎</div>
                            <div className="message-content">
                                <div className="message-header">
                                    <span className="chat-username">DiamondHands</span>
                                    <span className="chat-level">Lvl 12</span>
                                </div>
                                <div className="message-text">Lets goooo!</div>
                            </div>
                        </div>
                    </div>

                    {/* Chat Input */}
                    <div className="chat-input-area">
                        <div className="chat-input-wrapper">
                            <input
                                type="text"
                                className="chat-input"
                                placeholder="Type a message..."
                            />
                            <button className="chat-send-btn">➤</button>
                        </div>
                    </div>
                </div>
            )}
        </aside>
    );
};

export default RightSidebar;
