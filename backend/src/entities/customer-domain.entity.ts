import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Customer } from './customer.entity';

// Dominios de correo asociados a una empresa (customer). Se usan en el portal
// para auto-vincular cuentas nuevas por dominio corporativo: un email con
// @<dominio> apunta a esta empresa. Un customer puede tener varios dominios.
@Entity('customer_domains')
export class CustomerDomain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.domains, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  domain: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}