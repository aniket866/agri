import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  user: null,
  userData: null,
  loading: true,
  profileCompleted: true,
  
  setUser: (user) => set({ user }),
  setUserData: (userData) => set({ userData }),
  setLoading: (loading) => set({ loading }),
  setProfileCompleted: (completed) => set({ profileCompleted: completed }),
  
  reset: () => set({
    user: null,
    userData: null,
    loading: false,
    profileCompleted: true
  })
}));
