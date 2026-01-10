import React, { useState, useEffect, useRef } from 'react';

const Chat = ({ socket, username }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);

    useEffect(() => {
        if (!socket) return;

        const messageHandler = (msg) => {
            setMessages(prev => [...prev, msg].slice(-50)); // Keep last 50
        };

        socket.on('chatMessage', messageHandler);

        return () => {
            socket.off('chatMessage', messageHandler);
        };
    }, [socket]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = (e) => {
        e.preventDefault();
        if (!input.trim() || !socket) return;

        socket.emit('chatMessage', { message: input, username });
        setInput('');
    };

    return (
        <div className="card h-100 bg-dark border-secondary">
            <div className="card-header border-secondary text-white fw-bold">
                Live Chat
            </div>
            <div className="card-body p-2" style={{ height: '300px', overflowY: 'auto' }}>
                <div className="d-flex flex-column gap-2">
                    {messages.map((msg, idx) => (
                        <div key={idx} className="bg-secondary bg-opacity-25 p-2 rounded">
                            <span className="fw-bold text-info">{msg.username}</span>:
                            <span className="text-white ms-2">{msg.message}</span>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
            </div>
            <div className="card-footer border-secondary p-2">
                <form onSubmit={sendMessage} className="d-flex gap-2">
                    <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary small"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Say something..."
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Take</button>
                    {/* Typo in button text 'Take' -> 'Send' or similar? 'Send' is better. */}
                </form>
            </div>
        </div>
    );
};

export default Chat;
