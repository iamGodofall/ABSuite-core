import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { Button } from './Button';

const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button
      variant="tertiary"
      size="sm"
      onClick={toggleTheme}
      icon={theme === 'dark' ? Sun : Moon}
      className="w-full"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'} Mode
    </Button>
  );
};

export { ThemeToggle };

