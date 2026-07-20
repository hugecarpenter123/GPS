import { h } from 'preact';

type ButtonVariant = 'run' | 'restart' | 'pause' | 'delete';

const variantStyles: Record<ButtonVariant, string> = {
  run: 'border-green-600 text-green-600 hover:bg-green-600 hover:text-white',
  restart: 'border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white',
  pause: 'border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white',
  delete: 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white',
};

interface ActionButtonProps {
  variant: ButtonVariant;
  onClick: () => void;
  children: React.ReactNode;
}

export const ActionButton = ({ variant, onClick, children }: ActionButtonProps) => (
  <button
    // className={`cursor-pointer rounded border px-2 py-1 text-xs transition-all duration-150 ${variantStyles[variant]}`}
    className={`cursor-pointer px-2 py-1 text-[13px]`}
    onClick={onClick}
  >
    {children}
  </button>
);
