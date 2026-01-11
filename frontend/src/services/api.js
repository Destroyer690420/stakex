import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL;

// Validate API URL is set
if (!API_URL) {
    console.warn('REACT_APP_API_URL not set. API calls to backend will fail.');
}

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add token to requests
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Handle response errors with token refresh
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // If 401 and we haven't tried to refresh yet
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            const refreshToken = localStorage.getItem('refreshToken');
            if (refreshToken) {
                try {
                    // Try to refresh the token
                    const response = await axios.post(`${API_URL}/auth/refresh`, {
                        refreshToken
                    });

                    const { token, refreshToken: newRefreshToken } = response.data;
                    localStorage.setItem('token', token);
                    if (newRefreshToken) {
                        localStorage.setItem('refreshToken', newRefreshToken);
                    }

                    // Retry the original request with new token
                    originalRequest.headers.Authorization = `Bearer ${token}`;
                    return api(originalRequest);
                } catch (refreshError) {
                    // Refresh failed, logout user
                    localStorage.removeItem('token');
                    localStorage.removeItem('refreshToken');
                    window.location.href = '/login';
                    return Promise.reject(refreshError);
                }
            }

            // No refresh token, logout
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
        }

        return Promise.reject(error);
    }
);

export default api;
