'use client';
import { useId, type ButtonHTMLAttributes } from 'react';

// The same condition controls both availability and its visible explanation.
export function WorkAction({
  blockedBy,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  blockedBy: (string | false | null | undefined)[];
}) {
  const id = useId();
  const reason = blockedBy.find(Boolean);
  return (
    <>
      <button
        {...props}
        type={props.type || 'button'}
        disabled={!!reason}
        aria-describedby={reason ? id : undefined}
      >
        {children}
      </button>
      {reason && (
        <p id={id} className="work-action-reason">
          Чтобы продолжить: {reason}
        </p>
      )}
    </>
  );
}
