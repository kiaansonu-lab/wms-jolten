const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const InventoryLog = sequelize.define('InventoryLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  productId: { type: DataTypes.INTEGER, allowNull: false },
  warehouseId: { type: DataTypes.INTEGER, allowNull: false },
  type: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isIn: [['IN', 'OUT', 'TRANSFER', 'ALLOCATE', 'DEALLOCATE']] },
  },
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  referenceId: { type: DataTypes.STRING, allowNull: true },
  locationId: { type: DataTypes.INTEGER, allowNull: true },
  batchId: { type: DataTypes.INTEGER, allowNull: true },
  batchNumber: { type: DataTypes.STRING, allowNull: true },
  bestBeforeDate: { type: DataTypes.DATEONLY, allowNull: true },
  userId: { type: DataTypes.INTEGER, allowNull: true },
  reason: { type: DataTypes.STRING, allowNull: true },
  clientId: { type: DataTypes.INTEGER, allowNull: true },
  newStockLevel: { type: DataTypes.INTEGER, allowNull: true, field: 'new_stock_level' },
  newAllocatedLevel: { type: DataTypes.INTEGER, allowNull: true, field: 'new_allocated_level' },
  newOnHandLevel: { type: DataTypes.INTEGER, allowNull: true, field: 'new_on_hand_level' },
  newOffHandLevel: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'new_off_hand_level' },
}, {
  tableName: 'inventory_logs',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeCreate: async (log, options) => {
      try {
        const Inventory = log.sequelize.models.Inventory;
        if (Inventory) {
          const [inv] = await Inventory.findOrCreate({
            where: { productId: log.productId, warehouseId: log.warehouseId },
            defaults: { quantity: 0, reservedQuantity: 0 },
            transaction: options.transaction
          });
          log.newStockLevel = inv.quantity || 0;
          log.newAllocatedLevel = inv.reservedQuantity || 0;
          log.newOnHandLevel = Math.max(0, (inv.quantity || 0) - (inv.reservedQuantity || 0));
          log.newOffHandLevel = 0;
        }
      } catch (err) {
        console.error('Error calculating stock levels in beforeCreate hook:', err);
      }
    }
  }
});

module.exports = InventoryLog;
