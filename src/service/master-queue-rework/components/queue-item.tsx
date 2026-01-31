import { useRef } from 'preact/hooks';
import { cn } from '~/utility/plain-utility';
import { type QueueItem as TQueueItem } from '../master-queue';

const QueueItem = ({
  item,
  index,
  onDelete,
  className,
  onPositionChange,
  onDragStart,
  onDragEnd,
}: {
  item: TQueueItem;
  index: number;
  onDelete: () => void;
  className?: string;
  onPositionChange?: (item: TQueueItem, newPosition: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) => {
  const draggedElementRef = useRef<HTMLElement | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);

  const handleDragStart = (e: DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    draggedElementRef.current = target;

    // Notify parent about drag start
    onDragStart?.();

    // Store item ID in dataTransfer
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', item.id);
    e.dataTransfer!.setData('application/item-id', item.id);
    e.dataTransfer!.setData('application/item-index', index.toString());

    // Create ghost element with reduced opacity
    const dragGhost = target.cloneNode(true) as HTMLElement;
    dragGhost.style.opacity = '0.5';
    dragGhost.style.position = 'fixed';
    dragGhost.style.pointerEvents = 'none';
    dragGhost.style.zIndex = '10000';
    dragGhost.style.width = `${target.offsetWidth}px`;
    dragGhost.style.height = `${target.offsetHeight}px`;
    dragGhost.style.transform = 'rotate(5deg)';
    document.body.appendChild(dragGhost);
    dragGhostRef.current = dragGhost;

    // Set drag image to ghost
    e.dataTransfer!.setDragImage(dragGhost, e.offsetX, e.offsetY);

    // Make original semi-transparent
    target.style.opacity = '0.5';
  };

  const handleDragEnd = (e: DragEvent) => {
    const target = e.currentTarget as HTMLElement;

    // Notify parent about drag end
    onDragEnd?.();

    // Restore original opacity
    target.style.opacity = '1';

    // Remove ghost
    const dragGhost = dragGhostRef.current;
    if (dragGhost && dragGhost.parentNode) {
      document.body.removeChild(dragGhost);
      dragGhostRef.current = null;
    }

    draggedElementRef.current = null;
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();

    if (!onPositionChange) return;

    // Get dragged item info from dataTransfer
    const draggedItemId = e.dataTransfer!.getData('application/item-id');
    if (!draggedItemId) return;

    // Don't do anything if dropped on itself
    if (draggedItemId === item.id) return;

    // Find the target item index by checking which item the mouse is over
    // Look for the queue container with data-queue-container attribute
    const container = (e.currentTarget as HTMLElement).closest('[data-queue-container]');
    if (!container) return;

    const allItems = Array.from(container.children) as HTMLElement[];
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Find the item that contains the drop point
    let newPosition: number | null = null;
    for (let i = 0; i < allItems.length; i++) {
      const rect = allItems[i].getBoundingClientRect();
      if (mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom) {
        newPosition = i;
        break;
      }
    }

    // If no item was found under the mouse, return early
    if (newPosition === null) {
      return;
    }

    // Clamp position to valid range
    newPosition = Math.max(0, Math.min(newPosition, allItems.length - 1));

    // Call callback - parent will handle finding the dragged item by ID
    onPositionChange(item, newPosition);
  };

  return (
    <div
      data-item-id={item.id}
      draggable={!!onPositionChange}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'font-arial relative flex w-[50px] cursor-move flex-col items-center justify-center rounded border border-gray-400 p-1',
        className,
      )}
    >
      {/* Position badge */}
      <span className="pointer-events-none absolute top-1 left-1 z-10 text-[0.8rem] font-bold text-white select-none text-shadow-[0px_0px_2px_black]">
        {index + 1}
      </span>

      {/* Delete button */}
      <div
        className="absolute top-1 right-1 z-10 cursor-pointer text-[1rem] leading-4 text-red-500 transition-colors duration-200 hover:text-red-600"
        style={{ textShadow: '0px 0px 2px #000' }}
        onClick={onDelete}
      >
        &#x2715;
      </div>

      {/* Level bar (if exists) */}
      {item.ui.lvlBar && (
        <div className="absolute top-[36px] right-1 left-1 bg-black/30 pr-1 text-right text-[0.7rem] font-bold text-green-300">
          {item.ui.lvlBar}
        </div>
      )}

      {/* Item image */}
      <div className={`h-[50px] w-[50px] bg-yellow-200/50 ${item.ui.className ?? ''}`} style={item.ui.style} />

      {/* Item info */}
      <div className="flex flex-col items-center justify-center text-xs">
        <span className="max-w-[50px] overflow-hidden font-bold text-ellipsis whitespace-nowrap">{item.ui.title}</span>
        {item.ui.description && (
          <span className="max-w-[50px] overflow-hidden text-ellipsis whitespace-nowrap">{item.ui.description}</span>
        )}
        {(item.blocking === false || item.priority === 'high') && (
          <div className="flex w-full justify-between border-t">
            <span className="text-xs">{item.blocking === false && 'async'}</span>
            <span className="font-bold text-red-600">{item.priority === 'high' && 'H'}</span>
          </div>
        )}
        {/* <span>{item.priority === QueuePriority.High ? 'H' : 'N'}</span> */}
      </div>
    </div>
  );
};

export default QueueItem;
