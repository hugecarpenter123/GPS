import type { CitySchedule, QueueItem, QueuePriority } from '../../src/service/master-queue-rework/master-queue.rework';

// Mock data for testing MasterQueueTable component
export const props = {
  initialQueue: [
    {
      city: { name: 'Athens', cityId: '3', isleId: '2', switchAction: async () => {} },
      queue: [
        {
          id: 'item-1',
          itemType: 'builder' as const,
          itemDetails: {},
          priority: 'normal' as QueuePriority,
          maxShipmentTime: 3600000,
          supplyEvaluation: 'auto' as const,
          supplierCities: [],
          ui: {
            title: 'Barracks',
            lvlBar: 'Lvl 5',
            queueImageClass: 'building-barracks',
            queueBgImgProp: undefined,
          },
        },
        {
          id: 'item-2',
          itemType: 'recruiter' as const,
          itemDetails: {},
          priority: 'normal' as QueuePriority,
          maxShipmentTime: 3600000,
          supplyEvaluation: 'auto' as const,
          supplierCities: [],
          ui: {
            title: 'Swordsman',
            description: '50 units',
            lvlBar: undefined,
            queueImageClass: 'unit-sword',
            queueBgImgProp: undefined,
          },
        },
      ],
      currentAction: null,
      nonBlockingQueueComplex: {},
      timeoutData: {
        executionTime: Date.now() + 200000,
      },
    },
    {
      city: { name: 'Sparta', cityId: '3', isleId: '2', switchAction: async () => {} },
      queue: [
        {
          id: 'item-3',
          itemType: 'builder' as const,
          itemDetails: {},
          priority: 'high' as QueuePriority,
          maxShipmentTime: 3600000,
          supplyEvaluation: 'auto' as const,
          supplierCities: [],
          ui: {
            title: 'Temple',
            lvlBar: 'Lvl 10',
            queueImageClass: 'building-temple',
            queueBgImgProp: undefined,
          },
        },
      ],
      currentAction: 'builder' as const,
      nonBlockingQueueComplex: {
        recruiter: {
          queue: [
            {
              id: 'item-asd',
              itemType: 'recruiter' as const,
              itemDetails: {},
              priority: 'normal' as QueuePriority,
              maxShipmentTime: 3600000,
              supplyEvaluation: 'auto' as const,
              supplierCities: [],
              ui: {
                title: 'Swordsman',
                description: '50 units',
                lvlBar: undefined,
                queueImageClass: 'unit-sword',
                queueBgImgProp: undefined,
              },
            },
            {
              id: 'item-sda',
              itemType: 'recruiter' as const,
              itemDetails: {},
              priority: 'normal' as QueuePriority,
              maxShipmentTime: 3600000,
              supplyEvaluation: 'auto' as const,
              supplierCities: [],
              ui: {
                title: 'Hoplite',
                description: '50 units',
                lvlBar: undefined,
                queueImageClass: 'unit-sword',
                queueBgImgProp: undefined,
              },
            },
          ],
          timeoutData: {
            executionTime: Date.now() + 1000 * 60 * 1,
          },
        },
      },
      timeoutData: {
        executionTime: Date.now() + 1000 * 60 * 5,
      },
    },
    {
      city: { name: 'Corinth', cityId: '3', isleId: '2', switchAction: async () => {} },
      queue: [
        {
          id: 'item-4',
          itemType: 'recruiter' as const,
          itemDetails: {},
          priority: 'normal' as QueuePriority,
          maxShipmentTime: 3600000,
          supplyEvaluation: 'auto' as const,
          supplierCities: [],
          ui: {
            title: 'Archer',
            description: '100 units',
            lvlBar: undefined,
            queueImageClass: 'unit-archer',
            queueBgImgProp: undefined,
          },
        },
        {
          id: 'item-5',
          itemType: 'builder' as const,
          itemDetails: {},
          priority: 'normal' as QueuePriority,
          maxShipmentTime: 3600000,
          supplyEvaluation: 'auto' as const,
          supplierCities: [],
          ui: {
            title: 'Farm',
            lvlBar: 'Lvl 20',
            queueImageClass: 'building-farm',
            queueBgImgProp: undefined,
          },
        },
      ],
      currentAction: null,
      nonBlockingQueueComplex: {},
      timeoutData: {},
    },
  ] as CitySchedule[],
  onRunAll: () => {
    console.log('🚀 Run All clicked');
  },
  onResetAll: () => {
    console.log('🔄 Reset All clicked');
  },
  onDeleteAll: () => {
    console.log('🗑️ Delete All clicked');
  },
  onPauseAll: () => {
    console.log('⏸️ Pause All clicked');
  },
  onRunCity: (citySchedule: CitySchedule) => {
    console.log('▶️ Run City:', citySchedule.city.name);
  },
  onRestartCity: (citySchedule: CitySchedule) => {
    console.log('🔁 Restart City:', citySchedule.city.name);
  },
  onPauseCity: (citySchedule: CitySchedule) => {
    console.log('⏸️ Pause City:', citySchedule.city.name);
  },
  onDeleteCity: (citySchedule: CitySchedule) => {
    console.log('❌ Delete City:', citySchedule.city.name);
  },
  onDeleteItem: (citySchedule: CitySchedule, item: QueueItem) => {
    console.log('🗑️ Delete Item:', item.ui.title, 'from', citySchedule.city.name);
  },
};
