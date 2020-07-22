import { inject, injectable } from 'tsyringe';

import AppError from '@shared/errors/AppError';

import IProductsRepository from '@modules/products/repositories/IProductsRepository';
import ICustomersRepository from '@modules/customers/repositories/ICustomersRepository';
import Product from '@modules/products/infra/typeorm/entities/Product';
import Order from '../infra/typeorm/entities/Order';
import IOrdersRepository from '../repositories/IOrdersRepository';

interface IProduct {
  id: string;
  quantity: number;
}

interface IRequest {
  customer_id: string;
  products: IProduct[];
}

@injectable()
class CreateOrderService {
  constructor(
    @inject('OrdersRepository')
    private ordersRepository: IOrdersRepository,
    @inject('ProductsRepository')
    private productsRepository: IProductsRepository,
    @inject('CustomersRepository')
    private customersRepository: ICustomersRepository,
  ) {}

  private updateStockProducts(
    databaseProducts: Product[],
    orderProducts: IProduct[],
  ): Product[] {
    return databaseProducts.map(databaseProduct => {
      const orderedProduct = orderProducts.filter(
        orderProduct => orderProduct.id === databaseProduct.id,
      )[0];

      return {
        ...databaseProduct,
        quantity: databaseProduct.quantity - orderedProduct.quantity,
      };
    });
  }

  private findStockoutProducts(
    databaseProducts: Product[],
    orderProducts: IProduct[],
  ): IProduct[] {
    return orderProducts.filter(orderProduct => {
      const databaseProduct = databaseProducts.filter(
        each => each.id === orderProduct.id,
      )[0];

      return (
        databaseProduct.quantity === 0 ||
        databaseProduct.quantity < orderProduct.quantity
      );
    });
  }

  private findInvalidProducts(
    databaseProducts: IProduct[],
    orderProducts: IProduct[],
  ): IProduct[] {
    return databaseProducts.filter(databaseProduct => {
      const validProduct = orderProducts.find(
        orderProduct => orderProduct.id === databaseProduct.id,
      );

      if (validProduct === undefined) return true;
      return false;
    });
  }

  private removeDoubleProducts(products: IProduct[]): IProduct[] {
    return products.reduce((accumalator, current) => {
      const foundProduct = accumalator.find(
        (item: IProduct) => item.id === current.id,
      );
      if (foundProduct) return accumalator;
      return accumalator.concat([current]);
    }, [] as IProduct[]);
  }

  public async execute({ customer_id, products }: IRequest): Promise<Order> {
    const customer = await this.customersRepository.findById(customer_id);
    if (!customer) throw new AppError('Invalid customer identifier');

    const parsedProducts = this.removeDoubleProducts(products);

    const foundProducts = await this.productsRepository.findAllById(products);
    if (foundProducts.length < 1) {
      throw new AppError('Invalid products indentifier');
    }

    const invalidProducts = this.findInvalidProducts(
      foundProducts,
      parsedProducts,
    );
    if (invalidProducts.length > 0) {
      throw new AppError(
        `Invalid product on your order: ${invalidProducts[0].id}`,
      );
    }

    const stockoutProducts = this.findStockoutProducts(
      foundProducts,
      parsedProducts,
    );
    if (stockoutProducts.length > 0) {
      throw new AppError(`Stockout product: ${stockoutProducts[0].id}`);
    }

    const serialiazedProducts = parsedProducts.map(parsedProduct => ({
      product_id: parsedProduct.id,
      quantity: parsedProduct.quantity,
      price: foundProducts.filter(
        foundProduct => foundProduct.id === parsedProduct.id,
      )[0].price,
    }));

    const order = await this.ordersRepository.create({
      customer,
      products: serialiazedProducts,
    });

    const orderedProducts = this.updateStockProducts(
      foundProducts,
      parsedProducts,
    );

    await this.productsRepository.updateQuantity(orderedProducts);

    const parsedOrder = { ...order, order_products: order.orders_products };
    delete parsedOrder.orders_products;
    return parsedOrder;
  }
}

export default CreateOrderService;
