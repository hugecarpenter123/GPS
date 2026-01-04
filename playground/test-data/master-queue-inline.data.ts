import { CitySchedule } from '../../src/service/master-queue-rework/master-queue';

export const props = {
  schedule: {
    city: { name: 'Corinth', cityId: '3', isleId: '2', switchAction: async () => {} },
    queue: [
      {
        id: 'item-4',
        itemType: 'recruiter' as const,
        itemDetails: {},
        priority: 'normal' as const,
        blocking: false,
        maxShipmentTime: 3600000,
        supplyEvaluation: 'auto' as const,
        supplierCities: [],
        ui: {
          title: 'Archer',
          description: '100 units',
          lvlBar: undefined,
          className: 'unit-archer',
        },
      },
      {
        id: 'item-5',
        itemType: 'builder' as const,
        itemDetails: {},
        priority: 'normal' as const,
        maxShipmentTime: 3600000,
        supplyEvaluation: 'auto' as const,
        supplierCities: [],
        ui: {
          title: 'Farm',
          lvlBar: 'Lvl 20',
          className: 'building-farm',
        },
      },
      {
        id: 'item-9',
        itemType: 'builder' as const,
        itemDetails: {},
        priority: 'normal' as const,
        maxShipmentTime: 3600000,
        supplyEvaluation: 'auto' as const,
        supplierCities: [],
        ui: {
          title: 'Hide',
          lvlBar: 'Lvl 5',
          className: 'building-hide',
        },
      },
    ],
    currentAction: null,
    nonBlockingQueueComplex: {
      builder: {
        queue: [
          {
            id: 'item-6',
            itemType: 'builder' as const,
            itemDetails: {},
            priority: 'normal' as const,
            maxShipmentTime: 3600000,
            supplyEvaluation: 'auto' as const,
            supplierCities: [],
            ui: {
              title: 'Senate',
              lvlBar: 'Lvl 20',
              className: 'building-farm',
            },
          },
          {
            id: 'item-7',
            itemType: 'builder' as const,
            itemDetails: {},
            priority: 'normal' as const,
            maxShipmentTime: 3600000,
            supplyEvaluation: 'auto' as const,
            supplierCities: [],
            ui: {
              title: 'Senate',
              lvlBar: 'Lvl 21',
              className: 'building-farm',
            },
          },
        ],
        timeoutData: {
          purpose: 'slot',
        },
      },
    },
    timeoutData: {
      purpose: 'charms',
    },
  } as CitySchedule,
  onDeleteItem: () => {},
};
