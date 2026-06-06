const { SalesOrder, OrderItem, Product, Customer, Company, PickList, PickListItem, PackingTask, Warehouse, Shipment, ProductStock, sequelize } = require('../models');
const { Op } = require('sequelize');
const inventoryService = require('./inventoryService');

async function list(reqUser, query = {}) {
  const where = {};
  if (reqUser.role === 'super_admin') {
    if (query.companyId) where.companyId = query.companyId;
  } else {
    where.companyId = reqUser.companyId;
  }

  // Filter: Order Status
  if (query.status && query.status !== 'all') {
    where.status = query.status;
  }

  // Filter: Channel
  if (query.salesChannel && query.salesChannel !== 'all') {
    where.salesChannel = query.salesChannel;
  }

  // Filter: Courier Name
  if (query.courierName && query.courierName !== 'all') {
    where.courierName = query.courierName;
  }

  // Filter: Courier Service
  if (query.courierService && query.courierService !== 'all') {
    where.courierService = query.courierService;
  }

  // Filter: Dates
  const dateField = query.useRequiredDespatch === 'true' ? 'requiredDespatchDate' : 'orderDate';
  if (query.startDate || query.endDate) {
    const dateCond = {};
    if (query.startDate) dateCond[Op.gte] = query.startDate;
    if (query.endDate) dateCond[Op.lte] = query.endDate;
    where[dateField] = dateCond;
  }

  // Search filter (SKU, postcode, customer name, order number, billing/shipping address)
  if (query.search) {
    const searchVal = `%${query.search}%`;
    where[Op.or] = [
      { orderNumber: { [Op.like]: searchVal } },
      { postcode: { [Op.like]: searchVal } },
      { country: { [Op.like]: searchVal } },
      { externalRef: { [Op.like]: searchVal } },
      { tags: { [Op.like]: searchVal } },
      { '$Client.name$': { [Op.like]: searchVal } },
      { '$Client.address$': { [Op.like]: searchVal } },
      { '$Client.city$': { [Op.like]: searchVal } },
      { '$Client.postcode$': { [Op.like]: searchVal } },
      { '$OrderItems.Product.sku$': { [Op.like]: searchVal } }
    ];
  }

  // Pagination
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.pageSize, 10) || 20;
  const offset = (page - 1) * limit;

  const { rows, count } = await SalesOrder.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    include: [
      { association: 'Company', attributes: ['id', 'name', 'code'] },
      { association: 'Client', attributes: ['id', 'name', 'code', 'email', 'phone', 'contactPerson', 'address', 'city', 'state', 'country', 'postcode'] },
      {
        association: 'OrderItems',
        required: false,
        include: [
          { association: 'Product', attributes: ['id', 'name', 'sku', 'weight', 'weightUnit'] },
          { association: 'Warehouse', attributes: ['id', 'name'] }
        ]
      },
      { association: 'PickLists', include: [{ association: 'PickListItems', include: [{ association: 'Product' }] }] },
      { association: 'Shipment' },
    ],
    distinct: true,
    limit,
    offset,
  });

  return {
    items: rows.map((o) => o.get({ plain: true })),
    total: count,
    page,
    pageSize: limit
  };
}

async function getById(id, reqUser) {
  const order = await SalesOrder.findByPk(id, {
    include: [
      { association: 'Company' },
      { association: 'Client' },
      { association: 'OrderItems', include: ['Product', 'Warehouse'] },
      { association: 'PickLists', include: ['PickListItems', 'Warehouse', 'User'] },
      { association: 'PackingTasks', include: ['User'] },
      { association: 'Shipment' },
    ],
  });
  if (!order) throw new Error('Order not found');
  if (reqUser.role !== 'super_admin' && order.companyId !== reqUser.companyId) throw new Error('Order not found');
  return order;
}

async function create(data, reqUser) {
  if (reqUser.role !== 'super_admin' && reqUser.role !== 'company_admin') throw new Error('Only Company Admin can create sales orders');
  const companyId = reqUser.companyId;

  const t = await sequelize.transaction();
  try {
    const count = await SalesOrder.count({ where: { companyId }, transaction: t });
    const orderNumber = `ORD-${Date.now()}-${String(count + 1).padStart(4, '0')}`;

    // 1. If saveAddress is true, save this address to the customers table
    let customerId = data.customerId || null;
    if (data.saveAddress && !customerId && data.recipientName) {
      const newCustomer = await Customer.create({
        companyId,
        name: data.recipientName,
        contactPerson: data.recipientName,
        phone: data.phone || null,
        email: data.email || null,
        country: data.country || null,
        state: data.county || null,
        city: data.town || null,
        address: [data.addressLine1, data.addressLine2, data.addressLine3].filter(Boolean).join('\n'),
        postcode: data.postcode || null,
        status: 'ACTIVE'
      }, { transaction: t });
      customerId = newCustomer.id;
    }

    // 2. Create the SalesOrder record
    const order = await SalesOrder.create({
      companyId,
      orderNumber,
      customerId: customerId,
      orderDate: data.orderDate || null,
      requiredDate: data.requiredDate || null,
      requiredDespatchDate: data.requiredDespatchDate || data.requiredDate || null,
      requiredDeliveryDate: data.requiredDeliveryDate || data.requiredDate || null,
      priority: data.priority || 'MEDIUM',
      salesChannel: data.salesChannel || 'DIRECT',
      orderType: data.orderType || null,
      referenceNumber: data.referenceNumber || null,
      notes: data.notes || null,
      status: 'DRAFT',
      totalAmount: 0,
      createdBy: reqUser.id,
      recipientName: data.recipientName || null,
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      addressLine3: data.addressLine3 || null,
      town: data.town || null,
      county: data.county || null,
      postcode: data.postcode || null,
      country: data.country || null,
      phone: data.phone || null,
      email: data.email || null,
      courierName: data.courierName || null,
      courierService: data.courierService || null,
      requestedShippingService: data.requestedShippingService || null,
      noOfParcels: data.noOfParcels || 1,
      totalWeight: data.totalWeight || 0.0,
      tags: data.tags || null,
      externalRef: data.externalRef || null,
    }, { transaction: t });

    let total = 0;
    const warehouse = await Warehouse.findOne({ where: { companyId }, transaction: t });
    let hasSoftAllocations = false;

    if (data.items && data.items.length) {
      for (const row of data.items) {
        const product = await Product.findByPk(row.productId, { transaction: t });
        if (!product || product.companyId !== companyId) continue;

        const unitPrice = row.unitPrice ?? product.price;
        const qty = row.quantity || 1;

        // Resolve Target Warehouse
        let targetWarehouseId = row.warehouseId || warehouse?.id;
        if (!targetWarehouseId) {
          const firstStock = await ProductStock.findOne({
            where: { productId: product.id, companyId, quantity: { [Op.gt]: sequelize.col('reserved') } },
            transaction: t
          });
          targetWarehouseId = firstStock?.warehouseId;
        }
        if (!targetWarehouseId) {
          throw new Error(`Insufficient available stock for product ${product.sku} across all warehouses.`);
        }

        // Option 2: Manual Location Allocation
        if (row.locationId) {
          const stockRow = await ProductStock.findOne({
            where: {
              productId: product.id,
              warehouseId: targetWarehouseId,
              locationId: row.locationId,
              batchNumber: row.batchNumber || null,
              bestBeforeDate: row.bestBeforeDate || null,
              companyId
            },
            transaction: t
          });
          if (!stockRow || (stockRow.quantity - stockRow.reserved) < qty) {
            throw new Error(`Insufficient available stock at location selection for product ${product.sku}.`);
          }

          // Hard reserve in ProductStock row
          await stockRow.increment('reserved', { by: qty, transaction: t });
          
          // Soft reserve in warehouse total
          await inventoryService.reserveStockSoft({
            productId: product.id,
            warehouseId: targetWarehouseId,
            quantity: qty,
            referenceId: order.orderNumber,
            reason: `Order: ${order.orderNumber}`,
            userId: reqUser.id
          }, t);

          // Create hard-allocated OrderItem
          await OrderItem.create({
            salesOrderId: order.id,
            productId: product.id,
            quantity: qty,
            unitPrice: unitPrice,
            warehouseId: targetWarehouseId,
            locationId: row.locationId,
            batchNumber: row.batchNumber || null,
            bestBeforeDate: row.bestBeforeDate || null
          }, { transaction: t });
        } else {
          // Option 1: Soft Allocation
          hasSoftAllocations = true;

          // Verify total stock in selected warehouse is sufficient for soft reservation
          const stocks = await ProductStock.findAll({
            where: { productId: product.id, warehouseId: targetWarehouseId, companyId },
            transaction: t
          });
          const totalAvail = stocks.reduce((sum, s) => sum + (Number(s.quantity) - Number(s.reserved)), 0);
          if (totalAvail < qty) {
            throw new Error(`Insufficient available warehouse stock for product ${product.sku}.`);
          }

          // Soft reserve in warehouse total only
          await inventoryService.reserveStockSoft({
            productId: product.id,
            warehouseId: targetWarehouseId,
            quantity: qty,
            referenceId: order.orderNumber,
            reason: `Order: ${order.orderNumber}`,
            userId: reqUser.id
          }, t);

          // Create soft-allocated OrderItem (no locationId)
          await OrderItem.create({
            salesOrderId: order.id,
            productId: product.id,
            quantity: qty,
            unitPrice: unitPrice,
            warehouseId: targetWarehouseId
          }, { transaction: t });
        }

        total += Number(unitPrice) * qty;
      }
      
      await order.update({ totalAmount: total }, { transaction: t });
    }

    // 5. Create PickLists only if all items are fully allocated (meaning no soft allocations)
    if (!hasSoftAllocations && data.items && data.items.length) {
      const orderItemsForPick = await OrderItem.findAll({ where: { salesOrderId: order.id }, transaction: t });
      const warehouseGroups = {};
      orderItemsForPick.forEach(item => {
        if (!warehouseGroups[item.warehouseId]) warehouseGroups[item.warehouseId] = [];
        warehouseGroups[item.warehouseId].push(item);
      });

      for (const whId in warehouseGroups) {
        const pickList = await PickList.create({
          salesOrderId: order.id,
          warehouseId: whId,
          status: 'NOT_STARTED',
        }, { transaction: t });

        for (const item of warehouseGroups[whId]) {
          await PickListItem.create({
            pickListId: pickList.id,
            productId: item.productId,
            quantityRequired: item.quantity,
            quantityPicked: 0,
          }, { transaction: t });
        }
        await PackingTask.create({
          salesOrderId: order.id,
          pickListId: pickList.id,
          status: 'NOT_STARTED',
        }, { transaction: t });
      }

      await order.update({ status: 'CONFIRMED' }, { transaction: t });
    } else {
      // It remains DRAFT if soft allocations exist
      await order.update({ status: 'DRAFT' }, { transaction: t });
    }

    await t.commit();
    return getById(order.id, reqUser);
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

async function update(id, data, reqUser) {
  const t = await sequelize.transaction();
  try {
    const order = await SalesOrder.findByPk(id, {
      include: [{ association: 'OrderItems' }, { association: 'PickLists' }],
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!order) throw new Error('Order not found');
    if (reqUser.role !== 'super_admin' && order.companyId !== reqUser.companyId) throw new Error('Order not found');

    const allowedStatuses = ['DRAFT', 'CONFIRMED', 'BACKORDER'];
    if (!allowedStatuses.includes((order.status || '').toUpperCase())) {
      throw new Error('Only DRAFT, CONFIRMED, or BACKORDER orders can be edited');
    }

    // 1. Unreserve OLD items correctly
    if (order.OrderItems) {
      for (const item of order.OrderItems) {
        const whId = item.warehouseId || order.PickLists?.[0]?.warehouseId;
        if (!whId) continue;
        
        if (item.locationId) {
          const stockRow = await ProductStock.findOne({
            where: {
              productId: item.productId,
              warehouseId: whId,
              locationId: item.locationId,
              batchNumber: item.batchNumber || null,
              bestBeforeDate: item.bestBeforeDate || null,
              companyId: order.companyId
            },
            transaction: t
          });
          if (stockRow) {
            const toDeduct = Math.min(Number(stockRow.reserved), item.quantity);
            await stockRow.decrement('reserved', { by: toDeduct, transaction: t });
          }
          await inventoryService.unreserveStockSoft({
            productId: item.productId,
            warehouseId: whId,
            quantity: item.quantity,
            referenceId: order.orderNumber,
            reason: `Order Update (Deallocate): ${order.orderNumber}`,
            userId: reqUser.id
          }, t);
        } else {
          await inventoryService.unreserveStockSoft({
            productId: item.productId,
            warehouseId: whId,
            quantity: item.quantity,
            referenceId: order.orderNumber,
            reason: `Order Update (Deallocate): ${order.orderNumber}`,
            userId: reqUser.id
          }, t);
        }
      }
    }

    // 2. Update Order Details
    await order.update({
      customerId: data.customerId !== undefined ? data.customerId : order.customerId,
      orderDate: data.orderDate !== undefined ? data.orderDate : order.orderDate,
      requiredDate: data.requiredDate !== undefined ? data.requiredDate : order.requiredDate,
      requiredDespatchDate: data.requiredDespatchDate !== undefined ? data.requiredDespatchDate : (data.requiredDate !== undefined ? data.requiredDate : order.requiredDespatchDate),
      requiredDeliveryDate: data.requiredDeliveryDate !== undefined ? data.requiredDeliveryDate : (data.requiredDate !== undefined ? data.requiredDate : order.requiredDeliveryDate),
      priority: data.priority !== undefined ? data.priority : order.priority,
      salesChannel: data.salesChannel !== undefined ? data.salesChannel : order.salesChannel,
      orderType: data.orderType !== undefined ? data.orderType : order.orderType,
      referenceNumber: data.referenceNumber !== undefined ? data.referenceNumber : order.referenceNumber,
      notes: data.notes !== undefined ? data.notes : order.notes,
      
      recipientName: data.recipientName !== undefined ? data.recipientName : order.recipientName,
      addressLine1: data.addressLine1 !== undefined ? data.addressLine1 : order.addressLine1,
      addressLine2: data.addressLine2 !== undefined ? data.addressLine2 : order.addressLine2,
      addressLine3: data.addressLine3 !== undefined ? data.addressLine3 : order.addressLine3,
      town: data.town !== undefined ? data.town : order.town,
      county: data.county !== undefined ? data.county : order.county,
      postcode: data.postcode !== undefined ? data.postcode : order.postcode,
      country: data.country !== undefined ? data.country : order.country,
      phone: data.phone !== undefined ? data.phone : order.phone,
      email: data.email !== undefined ? data.email : order.email,
      courierName: data.courierName !== undefined ? data.courierName : order.courierName,
      courierService: data.courierService !== undefined ? data.courierService : order.courierService,
      requestedShippingService: data.requestedShippingService !== undefined ? data.requestedShippingService : order.requestedShippingService,
      noOfParcels: data.noOfParcels !== undefined ? data.noOfParcels : order.noOfParcels,
      totalWeight: data.totalWeight !== undefined ? data.totalWeight : order.totalWeight,
      tags: data.tags !== undefined ? data.tags : order.tags,
      externalRef: data.externalRef !== undefined ? data.externalRef : order.externalRef,
    }, { transaction: t });

    // 3. Update Items & Reserve NEW ones
    if (data.items && Array.isArray(data.items)) {
      await OrderItem.destroy({ where: { salesOrderId: order.id }, transaction: t });
      let total = 0;

      const currentWarehouse = await Warehouse.findOne({ where: { companyId: order.companyId }, transaction: t });
      let hasSoftAllocations = false;

      for (const row of data.items) {
        const product = await Product.findByPk(row.productId, { transaction: t });
        if (!product || product.companyId !== order.companyId) continue;

        const unitPrice = row.unitPrice ?? product.price;
        const qty = row.quantity || 1;

        let targetWarehouseId = row.warehouseId || currentWarehouse?.id;
        if (!targetWarehouseId) {
          throw new Error(`Warehouse is required for product ${product.sku}`);
        }

        if (row.locationId) {
          const stockRow = await ProductStock.findOne({
            where: {
              productId: product.id,
              warehouseId: targetWarehouseId,
              locationId: row.locationId,
              batchNumber: row.batchNumber || null,
              bestBeforeDate: row.bestBeforeDate || null,
              companyId: order.companyId
            },
            transaction: t
          });
          if (!stockRow || (stockRow.quantity - stockRow.reserved) < qty) {
            throw new Error(`Insufficient available stock at location selection for product ${product.sku}.`);
          }

          await stockRow.increment('reserved', { by: qty, transaction: t });
          await inventoryService.reserveStockSoft({
            productId: product.id,
            warehouseId: targetWarehouseId,
            quantity: qty,
            referenceId: order.orderNumber,
            reason: `Order: ${order.orderNumber}`,
            userId: reqUser.id
          }, t);

          await OrderItem.create({
            salesOrderId: order.id,
            productId: product.id,
            quantity: qty,
            unitPrice: unitPrice,
            warehouseId: targetWarehouseId,
            locationId: row.locationId,
            batchNumber: row.batchNumber || null,
            bestBeforeDate: row.bestBeforeDate || null
          }, { transaction: t });
        } else {
          // Option 1: Soft Allocation
          hasSoftAllocations = true;

          await inventoryService.reserveStockSoft({
            productId: product.id,
            warehouseId: targetWarehouseId,
            quantity: qty,
            referenceId: order.orderNumber,
            reason: `Order: ${order.orderNumber}`,
            userId: reqUser.id
          }, t);

          await OrderItem.create({
            salesOrderId: order.id,
            productId: product.id,
            quantity: qty,
            unitPrice: unitPrice,
            warehouseId: targetWarehouseId
          }, { transaction: t });
        }

        total += Number(unitPrice) * qty;
      }
      await order.update({ totalAmount: total }, { transaction: t });

      // Rebuild picklists if no soft allocations are present
      if (!hasSoftAllocations && data.items.length) {
        const existingPickLists = await PickList.findAll({ where: { salesOrderId: order.id }, transaction: t });
        for (const pl of existingPickLists) {
          await PickListItem.destroy({ where: { pickListId: pl.id }, transaction: t });
          await PackingTask.destroy({ where: { pickListId: pl.id }, transaction: t });
          await pl.destroy({ transaction: t });
        }
        await PackingTask.destroy({ where: { salesOrderId: order.id }, transaction: t });

        const orderItemsForPick = await OrderItem.findAll({ where: { salesOrderId: order.id }, transaction: t });
        const warehouseGroups = {};
        orderItemsForPick.forEach(item => {
          if (!warehouseGroups[item.warehouseId]) warehouseGroups[item.warehouseId] = [];
          warehouseGroups[item.warehouseId].push(item);
        });

        for (const whId in warehouseGroups) {
          const pickList = await PickList.create({
            salesOrderId: order.id,
            warehouseId: whId,
            status: 'NOT_STARTED',
          }, { transaction: t });

          for (const item of warehouseGroups[whId]) {
            await PickListItem.create({
              pickListId: pickList.id,
              productId: item.productId,
              quantityRequired: item.quantity,
              quantityPicked: 0,
            }, { transaction: t });
          }
          await PackingTask.create({
            salesOrderId: order.id,
            pickListId: pickList.id,
            status: 'NOT_STARTED',
          }, { transaction: t });
        }

        await order.update({ status: 'CONFIRMED' }, { transaction: t });
      } else {
        await order.update({ status: 'DRAFT' }, { transaction: t });
      }
    }

    await t.commit();
    return getById(order.id, reqUser);
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

async function remove(id, reqUser) {
  const t = await sequelize.transaction();
  try {
    const order = await SalesOrder.findByPk(id, {
      include: [{ association: 'OrderItems' }, { association: 'PickLists' }],
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!order) throw new Error('Order not found');
    if (reqUser.role !== 'super_admin' && order.companyId !== reqUser.companyId) throw new Error('Order not found');

    const allowedStatuses = ['DRAFT', 'CONFIRMED', 'BACKORDER', 'PICK_LIST_CREATED'];
    const status = (order.status || '').toUpperCase();
    if (!allowedStatuses.includes(status)) {
      throw new Error(`This sales order cannot be deleted. Current status: ${status || 'Unknown'}.`);
    }

    // UNRESERVE STOCK
    if (order.OrderItems) {
      for (const item of order.OrderItems) {
        const warehouseId = item.warehouseId || order.PickLists?.[0]?.warehouseId;
        if (!warehouseId) continue;

        if (item.locationId) {
          const stockRow = await ProductStock.findOne({
            where: {
              productId: item.productId,
              warehouseId,
              locationId: item.locationId,
              batchNumber: item.batchNumber || null,
              bestBeforeDate: item.bestBeforeDate || null,
              companyId: order.companyId
            },
            transaction: t
          });
          if (stockRow) {
            const toDeduct = Math.min(Number(stockRow.reserved), item.quantity);
            await stockRow.decrement('reserved', { by: toDeduct, transaction: t });
          }
          await inventoryService.unreserveStockSoft({
            productId: item.productId,
            warehouseId,
            quantity: item.quantity,
            referenceId: order.orderNumber,
            reason: `Order Deleted (Deallocate): ${order.orderNumber}`,
            userId: reqUser.id
          }, t);
        } else {
          await inventoryService.unreserveStockSoft({
            productId: item.productId,
            warehouseId,
            quantity: item.quantity,
            referenceId: order.orderNumber,
            reason: `Order Deleted (Deallocate): ${order.orderNumber}`,
            userId: reqUser.id
          }, t);
        }
      }
    }

    await OrderItem.destroy({ where: { salesOrderId: order.id }, transaction: t });
    const pickLists = await PickList.findAll({ where: { salesOrderId: order.id }, transaction: t });
    for (const pl of pickLists) {
      await PickListItem.destroy({ where: { pickListId: pl.id }, transaction: t });
      await PackingTask.destroy({ where: { pickListId: pl.id }, transaction: t });
      await pl.destroy({ transaction: t });
    }
    await PackingTask.destroy({ where: { salesOrderId: order.id }, transaction: t });
    await Shipment.destroy({ where: { salesOrderId: order.id }, transaction: t });
    await order.destroy({ transaction: t });

    await t.commit();
    return { message: 'Order deleted and stock unreserved' };
  } catch (err) {
    await t.rollback();
    throw err;
  }
}


async function bulkAction(data, reqUser) {
  const { action, ids, tag } = data;
  if (!ids || !Array.isArray(ids) || ids.length === 0) throw new Error('No order IDs provided');

  const companyWhere = reqUser.role === 'super_admin' ? {} : { companyId: reqUser.companyId };

  const orders = await SalesOrder.findAll({
    where: { id: { [Op.in]: ids }, ...companyWhere },
    include: [{ association: 'OrderItems' }, { association: 'PickLists' }]
  });

  let affected = 0;

  for (const order of orders) {
    try {
      if (action === 'delete') {
        const t = await sequelize.transaction();
        try {
          if (order.OrderItems) {
            for (const item of order.OrderItems) {
              const warehouseId = item.warehouseId || order.PickLists?.[0]?.warehouseId;
              if (!warehouseId) continue;

              if (item.locationId) {
                const stockRow = await ProductStock.findOne({
                  where: {
                    productId: item.productId,
                    warehouseId,
                    locationId: item.locationId,
                    batchNumber: item.batchNumber || null,
                    bestBeforeDate: item.bestBeforeDate || null,
                    companyId: order.companyId
                  },
                  transaction: t
                });
                if (stockRow) {
                  const toDeduct = Math.min(Number(stockRow.reserved), item.quantity);
                  await stockRow.decrement('reserved', { by: toDeduct, transaction: t });
                }
                await inventoryService.unreserveStockSoft({
                  productId: item.productId,
                  warehouseId,
                  quantity: item.quantity,
                  referenceId: order.orderNumber,
                  reason: `Order Bulk Deleted (Deallocate): ${order.orderNumber}`,
                  userId: reqUser.id
                }, t);
              } else {
                await inventoryService.unreserveStockSoft({
                  productId: item.productId,
                  warehouseId,
                  quantity: item.quantity,
                  referenceId: order.orderNumber,
                  reason: `Order Bulk Deleted (Deallocate): ${order.orderNumber}`,
                  userId: reqUser.id
                }, t);
              }
            }
          }
          await OrderItem.destroy({ where: { salesOrderId: order.id }, transaction: t });
          const pickLists = await PickList.findAll({ where: { salesOrderId: order.id }, transaction: t });
          for (const pl of pickLists) {
            await PickListItem.destroy({ where: { pickListId: pl.id }, transaction: t });
            await PackingTask.destroy({ where: { pickListId: pl.id }, transaction: t });
            await pl.destroy({ transaction: t });
          }
          await PackingTask.destroy({ where: { salesOrderId: order.id }, transaction: t });
          await Shipment.destroy({ where: { salesOrderId: order.id }, transaction: t });
          await order.destroy({ transaction: t });
          await t.commit();
          affected++;
        } catch (e) {
          await t.rollback();
        }
      } else if (action === 'mark_despatched') {
        await order.update({ status: 'SHIPPED' });
        affected++;
      } else if (action === 'confirm' || action === 'uncancel') {
        const t = await sequelize.transaction();
        try {
          if (order.status === 'CANCELLED' || order.status === 'DRAFT') {
            if (order.OrderItems) {
              for (const item of order.OrderItems) {
                const warehouseId = item.warehouseId || order.PickLists?.[0]?.warehouseId;
                if (!warehouseId) continue;
                await inventoryService.reserveStockSoft({
                  productId: item.productId,
                  warehouseId,
                  quantity: item.quantity,
                  referenceId: order.orderNumber,
                  reason: `Order Re-Confirmed/Uncancelled: ${order.orderNumber}`,
                  userId: reqUser.id
                }, t);
              }
            }
          }
          await order.update({ status: 'CONFIRMED' }, { transaction: t });
          await t.commit();
          affected++;
        } catch (e) {
          await t.rollback();
        }
      } else if (action === 'cancel') {
        const t = await sequelize.transaction();
        try {
          if (order.status !== 'CANCELLED') {
            if (order.OrderItems) {
              for (const item of order.OrderItems) {
                const warehouseId = item.warehouseId || order.PickLists?.[0]?.warehouseId;
                if (!warehouseId) continue;

                if (item.locationId) {
                  const stockRow = await ProductStock.findOne({
                    where: {
                      productId: item.productId,
                      warehouseId,
                      locationId: item.locationId,
                      batchNumber: item.batchNumber || null,
                      bestBeforeDate: item.bestBeforeDate || null,
                      companyId: order.companyId
                    },
                    transaction: t
                  });
                  if (stockRow) {
                    const toDeduct = Math.min(Number(stockRow.reserved), item.quantity);
                    await stockRow.decrement('reserved', { by: toDeduct, transaction: t });
                  }
                  await inventoryService.unreserveStockSoft({
                    productId: item.productId,
                    warehouseId,
                    quantity: item.quantity,
                    referenceId: order.orderNumber,
                    reason: `Order Cancelled (Deallocate): ${order.orderNumber}`,
                    userId: reqUser.id
                  }, t);
                } else {
                  await inventoryService.unreserveStockSoft({
                    productId: item.productId,
                    warehouseId,
                    quantity: item.quantity,
                    referenceId: order.orderNumber,
                    reason: `Order Cancelled (Deallocate): ${order.orderNumber}`,
                    userId: reqUser.id
                  }, t);
                }
              }
            }
          }
          await order.update({ status: 'CANCELLED' }, { transaction: t });
          await t.commit();
          affected++;
        } catch (e) {
          await t.rollback();
        }
      } else if (action === 'place_on_backorder') {
        await order.update({ status: 'BACKORDER' });
        affected++;
      } else if (action === 'mark_picked') {
        await order.update({ status: 'PICKED' });
        affected++;
      } else if (action === 'add_tag') {
        if (tag) {
          const existing = (order.tags || '').split(',').map(t => t.trim()).filter(Boolean);
          if (!existing.includes(tag)) existing.push(tag);
          await order.update({ tags: existing.join(', ') });
        }
        affected++;
      } else if (action === 'remove_tag') {
        if (tag) {
          const existing = (order.tags || '').split(',').map(t => t.trim()).filter(t => t && t !== tag);
          await order.update({ tags: existing.join(', ') });
        }
      } else if (action === 'allocate_stock') {
        const allocationService = require('./allocationService');
        await allocationService.allocateOrder(order.id);
        affected++;
      } else if (action === 'export_csv') {
        // handled client-side
        affected++;
      }
    } catch (e) {
      // skip individual failures
    }
  }

  return { affected, action };
}

async function allocateAllOrders(reqUser) {
  const companyWhere = reqUser.role === 'super_admin' ? {} : { companyId: reqUser.companyId };
  // Find all orders that are in DRAFT or BACKORDER status
  const orders = await SalesOrder.findAll({
    where: {
      status: { [Op.in]: ['DRAFT', 'BACKORDER'] },
      ...companyWhere
    },
    order: [
      ['orderDate', 'ASC'],
      ['id', 'ASC']
    ]
  });

  const allocationService = require('./allocationService');
  let successCount = 0;
  let backorderCount = 0;
  let errorCount = 0;

  for (const order of orders) {
    try {
      const result = await allocationService.allocateOrder(order.id);
      if (result.success) {
        successCount++;
      } else {
        backorderCount++;
      }
    } catch (e) {
      errorCount++;
    }
  }

  return { total: orders.length, successCount, backorderCount, errorCount };
}

module.exports = { list, getById, create, update, remove, bulkAction, allocateAllOrders };
