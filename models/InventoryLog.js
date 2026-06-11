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
        const { ProductStock, OrderItem, SalesOrder, Inventory } = log.sequelize.models;

        // 1. Calculate physical stock levels from ProductStock
        const psResult = await ProductStock.findOne({
          where: { productId: log.productId, warehouseId: log.warehouseId },
          attributes: [
            [log.sequelize.fn('SUM', log.sequelize.col('quantity')), 'totalQty'],
            [log.sequelize.fn('SUM', log.sequelize.col('reserved')), 'totalReserved']
          ],
          raw: true,
          transaction: options.transaction
        });

        const physicalQty = Number(psResult?.totalQty) || 0;
        const hardReserved = Number(psResult?.totalReserved) || 0;

        // 2. Calculate soft reservations from OrderItems for active orders
        const softResult = await OrderItem.findOne({
          where: {
            productId: log.productId,
            warehouseId: log.warehouseId,
            locationId: null
          },
          include: [{
            model: SalesOrder,
            as: 'SalesOrder',
            where: {
              status: ['DRAFT', 'CONFIRMED', 'BACKORDER', 'PICKING_IN_PROGRESS', 'PICKED', 'PACKING_IN_PROGRESS', 'PACKED']
            },
            attributes: []
          }],
          attributes: [
            [log.sequelize.fn('SUM', log.sequelize.col('quantity')), 'totalSoftReserved']
          ],
          raw: true,
          transaction: options.transaction
        });

        const softReserved = Number(softResult?.totalSoftReserved) || 0;

        // 3. Determine the final physical and reserved levels
        let finalPhysical = physicalQty;
        let finalReserved = hardReserved + softReserved;

        // Adjust for soft reservation changes if they haven't been written to the OrderItem table yet
        if (log.type === 'ALLOCATE') {
          finalReserved += Number(log.quantity) || 0;
        } else if (log.type === 'DEALLOCATE') {
          finalReserved += Number(log.quantity) || 0;
        }

        // 4. Ensure values are non-negative
        finalPhysical = Math.max(0, finalPhysical);
        finalReserved = Math.max(0, finalReserved);
        const finalOnHand = Math.max(0, finalPhysical - finalReserved);

        // 5. Update/Heal summary Inventory table
        if (Inventory) {
          const [inv] = await Inventory.findOrCreate({
            where: { productId: log.productId, warehouseId: log.warehouseId },
            defaults: { quantity: finalPhysical, reservedQuantity: finalReserved },
            transaction: options.transaction
          });
          await inv.update({
            quantity: finalPhysical,
            reservedQuantity: finalReserved
          }, { 
            transaction: options.transaction,
            silent: true 
          });
        }

        // 6. Assign levels to log record
        log.newStockLevel = finalPhysical;
        log.newAllocatedLevel = finalReserved;
        log.newOnHandLevel = finalOnHand;
        log.newOffHandLevel = 0;
      } catch (err) {
        console.error('Error calculating stock levels in beforeCreate hook:', err);
      }
    }
  }
});

module.exports = InventoryLog;
