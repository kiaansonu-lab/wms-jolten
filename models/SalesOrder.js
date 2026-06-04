const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const SalesOrder = sequelize.define('SalesOrder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  companyId: { type: DataTypes.INTEGER, allowNull: false },
  orderNumber: { type: DataTypes.STRING, allowNull: false },
  customerId: { type: DataTypes.INTEGER, allowNull: true },
  orderDate: { type: DataTypes.DATEONLY, allowNull: true },
  requiredDate: { type: DataTypes.DATEONLY, allowNull: true },
  priority: { type: DataTypes.STRING, defaultValue: 'MEDIUM' },
  salesChannel: { type: DataTypes.STRING, defaultValue: 'DIRECT' },
  orderType: { type: DataTypes.STRING, allowNull: true },
  referenceNumber: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'DRAFT',
    validate: { isIn: [['DRAFT', 'CONFIRMED', 'BACKORDER', 'PICKING_IN_PROGRESS', 'PICKED', 'PACKING_IN_PROGRESS', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED']] },
  },
  totalAmount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  createdBy: { type: DataTypes.INTEGER, allowNull: true },
  
  // New shipping/courier & traceability fields
  externalRef: { type: DataTypes.STRING, allowNull: true },
  parts: { type: DataTypes.STRING, defaultValue: '1of1' },
  postcode: { type: DataTypes.STRING, allowNull: true },
  country: { type: DataTypes.STRING, allowNull: true },
  courierName: { type: DataTypes.STRING, allowNull: true },
  courierService: { type: DataTypes.STRING, allowNull: true },
  requestedShippingService: { type: DataTypes.STRING, allowNull: true },
  requiredDespatchDate: { type: DataTypes.DATEONLY, allowNull: true },
  requiredDeliveryDate: { type: DataTypes.DATEONLY, allowNull: true },
  noOfParcels: { type: DataTypes.INTEGER, defaultValue: 1 },
  totalWeight: { type: DataTypes.DECIMAL(10, 3), defaultValue: 0.0 },
  totalItems: { type: DataTypes.INTEGER, defaultValue: 1 },
  trackingStatus: { type: DataTypes.STRING, allowNull: true },
  trackingNumber: { type: DataTypes.STRING, allowNull: true },
  tags: { type: DataTypes.STRING, allowNull: true },
  batchId: { type: DataTypes.INTEGER, defaultValue: 0 },
  orderLock: { type: DataTypes.BOOLEAN, defaultValue: false },
  recipientName: { type: DataTypes.STRING, allowNull: true },
  addressLine1: { type: DataTypes.STRING, allowNull: true },
  addressLine2: { type: DataTypes.STRING, allowNull: true },
  addressLine3: { type: DataTypes.STRING, allowNull: true },
  town: { type: DataTypes.STRING, allowNull: true },
  county: { type: DataTypes.STRING, allowNull: true },
  phone: { type: DataTypes.STRING, allowNull: true },
  email: { type: DataTypes.STRING, allowNull: true }
}, {
  tableName: 'sales_orders',
  timestamps: true,
  underscored: true,
});

module.exports = SalesOrder;
