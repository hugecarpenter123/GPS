import { cn } from '~/utility/plain-utility';
import { QueuePriority, type QueueItem as TQueueItem } from '../master-queue.rework';

const QueueItem = ({
  item,
  index,
  onDelete,
  className,
}: {
  item: TQueueItem;
  index: number;
  onDelete: () => void;
  className?: string;
}) => (
  <div
    className={cn(
      'relative flex w-[50px] flex-col items-center justify-center rounded border border-gray-400 p-1',
      className,
    )}
  >
    {/* Position badge */}
    <span className="pointer-events-none absolute top-1 left-1 z-10 text-[0.8rem] font-bold text-black select-none">
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
    <div
      className={`h-[50px] w-[50px] bg-yellow-200/50 ${item.ui.queueImageClass ?? ''}`}
      style={item.ui.queueBgImgProp ? { backgroundImage: item.ui.queueBgImgProp } : {}}
    />

    {/* Item info */}
    <div className="flex flex-col items-center justify-center text-xs">
      <span className="max-w-[50px] overflow-hidden font-bold text-ellipsis whitespace-nowrap">{item.ui.title}</span>
      {item.ui.description && (
        <span className="max-w-[50px] overflow-hidden text-ellipsis whitespace-nowrap">{item.ui.description}</span>
      )}
      {(item.blocking === false || item.priority === 'high') && (
        <div className="flex w-full justify-between border-t">
          <span>{item.blocking === false && 'async'}</span>
          <span className="font-bold text-red-600">{item.priority === 'high' && 'H'}</span>
        </div>
      )}
      {/* <span>{item.priority === QueuePriority.High ? 'H' : 'N'}</span> */}
    </div>
  </div>
);
export default QueueItem;
