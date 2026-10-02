import { useState } from 'react';
import { additionalIngredients, categoryLabels, flavorsById, ingredientsById, pizzaCrusts, pizzaFlavors, pizzaSizes, type PizzaCategory } from '../catalog';
import type { PizzaDraft, PizzaHalf } from '../types';
import { AssemblyIcon } from './AssemblyIcons';

function HalfBuilder({ half, label, onChange }: { half: PizzaHalf; label: string; onChange: (half: PizzaHalf) => void }) {
  const [additionalId, setAdditionalId] = useState('');
  const flavor = flavorsById[half.flavorId];
  const additions = half.modifiers.filter(modifier => modifier.type === 'ADD');
  return <fieldset className="ka-builder-half"><legend>{label}</legend>
    <label>Sabor<select aria-label={`Sabor — ${label}`} value={half.flavorId} onChange={event => { onChange({ flavorId: event.target.value, modifiers: [] }); setAdditionalId(''); }}>
      {(Object.keys(categoryLabels) as PizzaCategory[]).map(category => <optgroup key={category} label={categoryLabels[category]}>{pizzaFlavors.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}
    </select></label>
    <p className="ka-builder-help">Ingredientes da ficha. Desmarque para remover.</p>
    <div className="ka-builder-ingredients">{flavor.ingredientIds.map(id => {
      const removed = half.modifiers.some(modifier => modifier.type === 'REMOVE' && modifier.ingredientId === id);
      return <label key={id} className="ka-builder-check"><input type="checkbox" checked={!removed} onChange={() => onChange({ ...half, modifiers: removed ? half.modifiers.filter(modifier => !(modifier.type === 'REMOVE' && modifier.ingredientId === id)) : [...half.modifiers, { type: 'REMOVE', ingredientId: id }] })} /><span>{ingredientsById[id].name}</span>{removed && <small>Removido</small>}</label>;
    })}</div>
    <div className="ka-builder-add"><label>Adicionar ingrediente<select aria-label={`Adicional — ${label}`} value={additionalId} onChange={event => setAdditionalId(event.target.value)}><option value="">Selecione um adicional</option>{additionalIngredients.filter(item => !additions.some(modifier => modifier.ingredientId === item.ingredientId)).map(item => <option key={item.ingredientId} value={item.ingredientId}>{ingredientsById[item.ingredientId].name}</option>)}</select></label>
      <button className="button secondary" type="button" disabled={!additionalId} onClick={() => { onChange({ ...half, modifiers: [...half.modifiers, { type: 'ADD', ingredientId: additionalId }] }); setAdditionalId(''); }}><AssemblyIcon name="plus" />Adicionar</button></div>
    {additions.length > 0 && <ul className="ka-builder-additions">{additions.map(modifier => <li key={modifier.ingredientId}><AssemblyIcon name="plus" /><span>{ingredientsById[modifier.ingredientId].name}</span><button type="button" aria-label={`Remover adicional ${ingredientsById[modifier.ingredientId].name}`} onClick={() => onChange({ ...half, modifiers: half.modifiers.filter(item => item !== modifier) })}>Remover adicional</button></li>)}</ul>}
  </fieldset>;
}

export function PizzaBuilder({ pizza, index, onChange }: { pizza: PizzaDraft; index: number; onChange: (pizza: PizzaDraft) => void }) {
  return <fieldset className="ka-builder"><legend>Pizza {index + 1}</legend>
    <div className="form-grid">
      <label>Tamanho<select aria-label={`Tamanho da pizza ${index + 1}`} value={pizza.size} onChange={event => {
        if (event.target.value === 'BROTO') onChange({ size: 'BROTO', composition: 'WHOLE', firstHalf: pizza.firstHalf, crustId: pizza.crustId, notes: pizza.notes });
        else onChange({ ...pizza, size: 'GRANDE' });
      }}>{Object.entries(pizzaSizes).map(([id, size]) => <option key={id} value={id}>{size.label}</option>)}</select></label>
      <label>Composição<select aria-label={`Composição da pizza ${index + 1}`} value={pizza.composition} disabled={pizza.size === 'BROTO'} onChange={event => {
        if (event.target.value === 'WHOLE') onChange({ size: pizza.size, composition: 'WHOLE', firstHalf: pizza.firstHalf, crustId: pizza.crustId, notes: pizza.notes });
        else onChange({ size: 'GRANDE', composition: 'HALF_HALF', firstHalf: pizza.firstHalf, secondHalf: { flavorId: pizza.firstHalf.flavorId, modifiers: [] }, crustId: pizza.crustId, notes: pizza.notes });
      }}><option value="WHOLE">Inteira</option>{pizza.size === 'GRANDE' && <option value="HALF_HALF">Meio a meio</option>}</select>{pizza.size === 'BROTO' && <small>Broto permite somente sabor único.</small>}</label>
    </div>
    <div className={pizza.composition === 'HALF_HALF' ? 'ka-builder-halves' : ''}>
      <HalfBuilder half={pizza.firstHalf} label={pizza.composition === 'HALF_HALF' ? '1ª metade' : 'Sabor único'} onChange={firstHalf => onChange({ ...pizza, firstHalf })} />
      {pizza.composition === 'HALF_HALF' && <HalfBuilder half={pizza.secondHalf} label="2ª metade" onChange={secondHalf => onChange({ ...pizza, secondHalf })} />}
    </div>
    <div className="form-grid"><label>Borda<select aria-label={`Borda da pizza ${index + 1}`} value={pizza.crustId} onChange={event => onChange({ ...pizza, crustId: event.target.value })}>{pizzaCrusts.map(crust => <option key={crust.id} value={crust.id}>{crust.name}</option>)}</select></label>
      <label>Observação<input aria-label={`Observação da pizza ${index + 1}`} maxLength={1000} value={pizza.notes ?? ''} placeholder="Ex.: Bem assada" onChange={event => onChange({ ...pizza, notes: event.target.value || null })} /></label></div>
  </fieldset>;
}
