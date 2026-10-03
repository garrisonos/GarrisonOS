import { html, raw, SafeHtml } from '../lib/html.js';
import { RequestContext } from '../../core/context.js';
import { CustomFieldsService, CustomFieldDefinitionRecord, CustomFieldEntityType, CustomFieldSectionRecord } from '../../core/custom-fields.js';

export interface RenderCustomFieldsOptions {
  disabled?: boolean;
  operatorId?: string;
}

/**
 * Reusable SSR generator that inspects active custom field definitions and sections,
 * rendering typed input form controls inside structured fieldset cards.
 *
 * @param entityType - Target domain entity type ('property', 'unit', 'lease', 'contact', 'work_order', 'bill').
 * @param currentValues - Existing custom field values dictionary from the entity record.
 * @param options - Optional rendering flags (disabled, operatorId).
 * @returns SafeHtml template component.
 */
export function renderCustomFields(
  entityType: CustomFieldEntityType,
  currentValues: Record<string, any> = {},
  options: RenderCustomFieldsOptions = {}
): SafeHtml {
  const opId = options.operatorId || RequestContext.tryGet()?.operatorId;
  if (!opId) {
    return raw('');
  }
  const sections = CustomFieldsService.listSections(entityType, opId);
  const definitions = CustomFieldsService.listDefinitions(entityType, opId);

  if (definitions.length === 0) {
    return raw('');
  }

  // Group definitions by section_id
  const sectionMap = new Map<string, { section: CustomFieldSectionRecord | null; fields: CustomFieldDefinitionRecord[] }>();

  // Register defined sections
  for (const sec of sections) {
    sectionMap.set(sec.id, { section: sec, fields: [] });
  }

  // Register unsectioned default group
  const defaultGroupId = '__default__';
  sectionMap.set(defaultGroupId, { section: null, fields: [] });

  // Distribute fields
  for (const def of definitions) {
    const sId = def.section_id && sectionMap.has(def.section_id) ? def.section_id : defaultGroupId;
    sectionMap.get(sId)!.fields.push(def);
  }

  const renderSingleField = (def: CustomFieldDefinitionRecord): SafeHtml => {
    const val = currentValues[def.field_name] ?? def.default_value ?? '';
    const fieldId = `cf_${def.field_name}`;
    const fieldName = `cf_${def.field_name}`;
    const requiredAttr = def.is_required ? raw('required') : raw('');
    const disabledAttr = options.disabled ? raw('disabled') : raw('');

    let inputElement: SafeHtml;

    switch (def.data_type) {
      case 'string':
        inputElement = html`
          <input
            type="text"
            id="${fieldId}"
            name="${fieldName}"
            value="${String(val)}"
            class="form-control"
            ${requiredAttr}
            ${disabledAttr}
          />
        `;
        break;

      case 'number':
        inputElement = html`
          <input
            type="number"
            step="any"
            id="${fieldId}"
            name="${fieldName}"
            value="${val !== '' ? String(val) : ''}"
            class="form-control"
            ${requiredAttr}
            ${disabledAttr}
          />
        `;
        break;

      case 'currency': {
        const dollars = typeof val === 'number' ? (val / 100).toFixed(2) : String(val);
        inputElement = html`
          <div style="position: relative; display: flex; align-items: center;">
            <span style="position: absolute; left: 0.75rem; color: var(--text-muted); font-weight: 600;">$</span>
            <input
              type="number"
              step="0.01"
              id="${fieldId}"
              name="${fieldName}"
              value="${dollars}"
              class="form-control"
              style="padding-left: 1.75rem;"
              ${requiredAttr}
              ${disabledAttr}
            />
          </div>
        `;
        break;
      }

      case 'date':
        inputElement = html`
          <input
            type="date"
            id="${fieldId}"
            name="${fieldName}"
            value="${String(val)}"
            class="form-control"
            pattern="\\d{4}-\\d{2}-\\d{2}"
            ${requiredAttr}
            ${disabledAttr}
          />
        `;
        break;

      case 'boolean': {
        const isChecked = val === true || val === '1' || val === 1 || val === 'true' || val === 'on';
        inputElement = html`
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; margin-top: 0.5rem;">
            <input
              type="checkbox"
              id="${fieldId}"
              name="${fieldName}"
              value="1"
              ${isChecked ? raw('checked') : raw('')}
              ${disabledAttr}
            />
            <span style="font-size: 0.9rem;">Enabled / Active</span>
          </label>
        `;
        break;
      }

      case 'select': {
        const optionsList = def.options || [];
        inputElement = html`
          <select id="${fieldId}" name="${fieldName}" class="form-control" ${requiredAttr} ${disabledAttr}>
            <option value="">-- Select ${def.field_label} --</option>
            ${optionsList.map(
              (opt) => html`
                <option value="${opt}" ${String(val) === opt ? raw('selected') : raw('')}>${opt}</option>
              `
            )}
          </select>
        `;
        break;
      }
    }

    return html`
      <div class="form-group" style="margin-bottom: 1rem;" data-custom-field="${def.field_name}">
        <label for="${fieldId}" style="display: block; font-weight: 500; margin-bottom: 0.35rem;">
          ${def.field_label}
          ${def.is_required ? html`<span class="text-danger" title="Required field">*</span>` : raw('')}
        </label>
        ${inputElement}
      </div>
    `;
  };

  const renderedGroups: SafeHtml[] = [];

  for (const [_sId, group] of sectionMap.entries()) {
    if (group.fields.length === 0) continue;

    const sectionTitle = group.section ? group.section.title : 'Additional Custom Information';

    renderedGroups.push(html`
      <fieldset class="card custom-fields-card" style="margin-bottom: 1.5rem; padding: 1.5rem;">
        <legend style="font-size: 1.05rem; font-weight: 600; padding: 0 0.5rem; color: var(--text-main);">
          ${sectionTitle}
        </legend>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem;">
          ${group.fields.map(renderSingleField)}
        </div>
      </fieldset>
    `);
  }

  return html`${renderedGroups}`;
}

export const renderCustomFieldsSSR = renderCustomFields;

