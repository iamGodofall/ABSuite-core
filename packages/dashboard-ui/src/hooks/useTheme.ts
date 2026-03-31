import { create } from 'zustand';

interface ThemeState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    set({ theme });
  },
  toggleTheme: () => {
    const current = get().theme;
    const newTheme = current === 'dark' ? 'light' : 'dark';
    get().setTheme(newTheme);
  },
}));

// Initialize on mount
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('theme') as 'dark' | 'light';
  if (saved) {
    document.documentElement.classList.toggle('dark', saved === 'dark');
  }
}

