/**
 * Button - Industry-standard button with micro-interactions
 * 
 * Features:
 * - Press feedback (scale down on click)
 * - Smooth hover elevation
 * - Loading state with spinner
 * - Multiple variants and sizes
 */

import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMotionConfig } from '@/lib/motion';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  children?: React.ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-content text-surface hover:bg-content/90 shadow-sm hud-ripple',
  secondary: 'bg-surface-secondary text-content-secondary hover:bg-surface-secondary border border-edge/60 hud-ripple',
  ghost: 'bg-transparent text-content-secondary hover:bg-surface-hover hover:text-content-secondary hud-ripple',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm hud-ripple',
  success: 'bg-green-600 text-white hover:bg-green-700 shadow-sm hud-ripple',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-6 text-base gap-2.5 rounded-lg',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconPosition = 'left',
      children,
      fullWidth = false,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    const { instant, transition } = useMotionConfig();

    return (
      <motion.button
        ref={ref}
        whileHover={!isDisabled && !instant ? { y: -1 } : undefined}
        whileTap={!isDisabled && !instant ? { scale: 0.98 } : undefined}
        transition={transition({ type: 'tween', duration: 0.1 })}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors will-change-transform',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none disabled:saturate-50',
          variantStyles[variant],
          sizeStyles[size],
          fullWidth && 'w-full',
          className
        )}
        disabled={isDisabled}
        {...props}
      >
        {loading ? (
          <Loader2 className={cn('motion-safe:animate-spin', size === 'sm' ? 'h-3 w-3' : 'h-4 w-4')} />
        ) : (
          icon && iconPosition === 'left' && icon
        )}
        {children}
        {!loading && icon && iconPosition === 'right' && icon}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';

/**
 * IconButton - Square button for icons only
 */
interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
  label: string; // Required for accessibility
}

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 w-7 rounded-md',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-11 w-11 rounded-lg',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant = 'ghost',
      size = 'md',
      loading = false,
      children,
      label,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    const { instant, transition } = useMotionConfig();

    return (
      <motion.button
        ref={ref}
        whileHover={!isDisabled && !instant ? { scale: 1.05 } : undefined}
        whileTap={!isDisabled && !instant ? { scale: 0.95 } : undefined}
        transition={transition({ type: 'spring', stiffness: 400, damping: 17 })}
        className={cn(
          'inline-flex items-center justify-center transition-colors will-change-transform',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none disabled:saturate-50',
          variantStyles[variant],
          iconSizeStyles[size],
          className
        )}
        disabled={isDisabled}
        aria-label={label}
        title={label}
        {...props}
      >
        {loading ? (
          <Loader2 className={cn('motion-safe:animate-spin', size === 'sm' ? 'h-3 w-3' : 'h-4 w-4')} />
        ) : (
          children
        )}
      </motion.button>
    );
  }
);

IconButton.displayName = 'IconButton';

export default Button;
