import { useEffect, useState } from 'preact/hooks';
import { ScheduleItem, ScheduleItemEditData } from '../Scheduler';
import SchedulerEditDialog from './scheduler-edit-dialog';

interface SchedulerTableActionProps {
  onEditClick: (editData: ScheduleItemEditData) => { success: boolean; message?: string };
  onCancelClick: () => void;
  scheduleItem: ScheduleItem;
  scheduleList: ScheduleItem[];
}

export default function SchedulerTableAction({
  onEditClick,
  onCancelClick,
  scheduleItem,
  scheduleList,
}: SchedulerTableActionProps) {
  const [open, setOpen] = useState(false);
  const [openEditDialog, setOpenEditDialog] = useState(false);

  const handleOnCancelClick = () => {
    onCancelClick();
  };
  const handleEditClick = () => {
    setOpen(false);
    setOpenEditDialog(true);
  };

  return (
    <>
      <button class="scheduler-actions" onClick={() => setOpen(prev => !prev)} onBlur={() => setOpen(false)}>
        {/* trigger */}
        <svg
          class="scheduler-actions-icon"
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <circle cx="2" cy="10" r="2" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="18" cy="10" r="2" />
        </svg>
        {/* dropdown */}
        {open && (
          <div class="scheduler-action-dropdown">
            <div class="scheduler-action-dropdown-item" onClick={handleEditClick}>
              Edit
            </div>

            <div className="dropdown-menu-separator"></div>
            <div class="scheduler-action-dropdown-item" onClick={handleOnCancelClick}>
              Cancel
            </div>
          </div>
        )}
      </button>
      {/* edit dialog */}
      {openEditDialog && (
        <SchedulerEditDialog
          open={openEditDialog}
          setOpen={setOpenEditDialog}
          onEdit={onEditClick}
          scheduleList={scheduleList}
          scheduleItem={scheduleItem}
        />
      )}
    </>
  );
}
