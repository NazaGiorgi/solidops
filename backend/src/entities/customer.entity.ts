import { Column, Entity, Index, OneToMany } from 'typeorm';
import { SoftDeleteEntity } from '../common/entities/soft-delete.entity';
import { Contact } from './contact.entity';
import { Site } from './site.entity';
import { Contract } from './contract.entity';
import { CustomerDomain } from './customer-domain.entity';

@Entity('customers')
export class Customer extends SoftDeleteEntity {
  @Index()
  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Por defecto cada contacto ve solo sus propios tickets. Solo clientes
  // habilitados explícitamente pueden compartir el portal entre contactos.
  @Column({ name: 'shared_portal', type: 'boolean', default: false })
  sharedPortal: boolean;

  @OneToMany(() => Contact, (contact) => contact.customer)
  contacts: Contact[];

  @OneToMany(() => Site, (site) => site.customer)
  sites: Site[];

  @OneToMany(() => Contract, (contract) => contract.customer)
  contracts: Contract[];

  @OneToMany(() => CustomerDomain, (domain) => domain.customer)
  domains: CustomerDomain[];
}
