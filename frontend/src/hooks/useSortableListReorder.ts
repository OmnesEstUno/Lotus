import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { TOUCH_SENSOR_DELAY_MS, TOUCH_SENSOR_TOLERANCE_PX } from '../utils/constants';

/**
 * Sets up dnd-kit sensors and a drag-end handler that calls arrayMove
 * on a list of identifiers. Use with <DndContext sensors onDragEnd>
 * + <SortableContext items={...}>.
 */
export function useSortableListReorder<T extends string>(
  items: T[],
  setItems: (next: T[]) => void,
) {
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_SENSOR_DELAY_MS,
        tolerance: TOUCH_SENSOR_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.indexOf(active.id as T);
    const newIdx = items.indexOf(over.id as T);
    if (oldIdx < 0 || newIdx < 0) return;
    setItems(arrayMove(items, oldIdx, newIdx));
  }

  return { sensors, onDragEnd };
}
