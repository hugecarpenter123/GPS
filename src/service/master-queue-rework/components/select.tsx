import { useEffect, useState } from 'preact/hooks';

export const Select = ({
  triggerType = 'button',
  options,
  onSelect,
}: {
  children?: preact.ComponentChildren;
  triggerType?: 'text' | 'button';
  options: { value: string; label: string; initial?: boolean }[];
  onSelect: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(options.find(el => el.initial) ?? options[0]);
  //   useEffect(() => {
  //     const clb = (e: PointerEvent)=>{

  //     }
  //     document.addEventListener('click', clb)
  //     return () =>
  //   }, [])
  return (
    <div className="relative">
      {triggerType === 'text' ? (
        <div onClick={() => setOpen(prev => !prev)} className="flex cursor-pointer items-center gap-1">
          {selection.label}
          <svg className="inline h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0l-4.25-4.39a.75.75 0 0 1 .02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      ) : (
        <button onClick={() => setOpen(prev => !prev)} className="flex cursor-pointer items-center gap-1">
          {selection.label}
          <svg className="inline h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0l-4.25-4.39a.75.75 0 0 1 .02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
      {open && (
        <div className="absolute top-7 right-0 z-20 max-w-[120px] min-w-max rounded border border-gray-300 bg-white p-1 shadow">
          {options.map(option => (
            <div
              className="cursor-default px-2 py-1 text-xs text-black/80 transition-colors hover:bg-[#f5f5f5] hover:text-black"
              onClick={() => {
                setSelection(option);
                onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Select;

const Separator = () => {
  return <div className="mx-auto my-[2px] h-[.5px] w-[90%] bg-[lightgray]" />;
};
