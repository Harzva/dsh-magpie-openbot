(function (root) {
  'use strict';

  var document = root.document;
  var state = {
    initialized: false,
    busy: false,
    status: null,
    baselineGateway: '',
    message: '',
    messageState: 'idle',
    unsupported: false,
    transientSecret: '',
    unsubscribeChanges: null
  };
  var els = {};

  function tr(zh, en, params) {
    return root.OpenBotI18n && typeof root.OpenBotI18n.t === 'function'
      ? root.OpenBotI18n.t(zh, en, params) : zh;
  }

  function isEnglish() {
    return !!(root.OpenBotI18n && root.OpenBotI18n.locale === 'en');
  }

  function hasCjk(value) {
    return /[\u3400-\u9fff]/.test(String(value || ''));
  }

  function statusToken(value) {
    return String(value || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/_/g, '-');
  }

  function localizedStatusMessage(value, fallback) {
    var text = secretSafe(value);
    if (!text) return fallback || '';
    if (isEnglish() && hasCjk(text)) return fallback || '';
    return text;
  }

  function node(tag, className, text) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function labeled(tag, id, zh, en, className) {
    var label = node(tag, className || 'magpie-field');
    var caption = node('span', '', tr(zh, en));
    var control = document.createElement(tag === 'div' ? 'div' : 'input');
    if (tag === 'div') return label;
    control.id = id;
    label.htmlFor = id;
    label.appendChild(caption);
    label.appendChild(control);
    return { label: label, control: control };
  }

  function message(value, tone) {
    state.message = value || '';
    state.messageState = tone || 'idle';
    if (!els.message) return;
    els.message.textContent = state.message;
    els.message.dataset.state = state.messageState;
  }

  function apiMethod(name) {
    return root.grokbot && typeof root.grokbot[name] === 'function' ? root.grokbot[name] : null;
  }

  function callApi(name, args) {
    var method = apiMethod(name);
    if (!method) throw new Error(tr('此功能需要更新后的 OpenBot 桌面版。', 'This feature requires an updated OpenBot desktop app.'));
    return method.apply(root.grokbot, args || []);
  }

  function secretSafe(value) {
    var text = String(value == null ? '' : value);
    var secret = state.transientSecret || (els.apiKey && els.apiKey.value);
    if (secret) text = text.split(secret).join(tr('••••••••', '••••••••'));
    return text;
  }

  function appendIcon(container) {
    var icon = node('span', 'app-connection-icon');
    icon.setAttribute('aria-hidden', 'true');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var paths = ['M8 8.5 5.5 6M16 8.5 18.5 6M7 13.5h10M9 17.5h6', 'M5 5.5 3.5 4M19 5.5 20.5 4', 'M8 8a4 4 0 0 1 8 0v5.5a4 4 0 0 1-8 0V8Z'];
    paths.forEach(function (path) {
      var item = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      item.setAttribute('d', path);
      svg.appendChild(item);
    });
    icon.appendChild(svg);
    container.appendChild(icon);
  }

  function button(id, text, className, action) {
    var item = node('button', 'btn' + (className ? ' ' + className : ''), text);
    item.type = 'button';
    item.id = id;
    item.dataset.magpieAction = action;
    return item;
  }

  function build() {
    var host = document.getElementById('magpie-root');
    if (!host || state.initialized) return false;
    state.initialized = true;
    host.replaceChildren();
    var section = document.getElementById('magpie-interconnect-section');
    if (section) section.classList.add('apps-card', 'apps-magpie-card');

    var header = node('header', 'magpie-header');
    appendIcon(header);
    var heading = node('div', 'magpie-heading');
    var titleRow = node('div', 'magpie-title-row');
    var title = node('h3', '', tr('DSH 插件与 Magpie', 'DSH plugins & Magpie'));
    title.id = 'magpie-title';
    titleRow.appendChild(title);
    var statusWrap = node('div', 'magpie-status-wrap');
    els.status = node('span', 'apps-status', tr('尚未读取', 'Not checked'));
    els.status.id = 'magpie-status';
    els.status.setAttribute('role', 'status');
    els.status.setAttribute('aria-live', 'polite');
    els.status.dataset.state = 'idle';
    els.refresh = button('magpie-refresh', tr('刷新', 'Refresh'), '', 'refresh');
    statusWrap.append(els.status, els.refresh);
    titleRow.appendChild(statusWrap);
    var description = node('p', 'apps-description', tr(
      '安装本地 DSH 插件，检查依赖服务，连接 Magpie 网关并创建模型连接。',
      'Install a local DSH plugin, check its services, connect a Magpie gateway and create a model connection.'
    ));
    heading.append(titleRow, description);
    header.appendChild(heading);
    host.appendChild(header);

    els.message = node('p', 'magpie-message');
    els.message.id = 'magpie-message';
    els.message.setAttribute('role', 'status');
    els.message.setAttribute('aria-live', 'polite');
    els.message.setAttribute('aria-atomic', 'true');
    host.appendChild(els.message);

    els.installed = node('p', 'magpie-installed');
    els.installed.id = 'magpie-installed';
    host.appendChild(els.installed);

    var install = node('section', 'magpie-block');
    var installTitle = node('h4', '', tr('安装本地插件', 'Install local plugin'));
    installTitle.id = 'magpie-install-title';
    install.setAttribute('aria-labelledby', installTitle.id);
    var installActions = node('div', 'magpie-actions');
    els.installBundled = button('magpie-install-bundled', tr('安装 Magpie 插件', 'Install Magpie plugin'), 'primary', 'install-bundled');
    var installAlternatives = node('details', 'magpie-install-alternatives');
    var installAlternativesSummary = node('summary', '', tr('其他安装方式', 'More install options'));
    installAlternatives.appendChild(installAlternativesSummary);
    var alternativeActions = node('div', 'magpie-actions magpie-install-alternative-actions');
    els.installFile = button('magpie-install-file', tr('导入 .tgz 文件', 'Import .tgz file'), '', 'install-file');
    els.installDirectory = button('magpie-install-directory', tr('从文件夹安装', 'Install from folder'), '', 'install-directory');
    alternativeActions.append(els.installFile, els.installDirectory);
    installAlternatives.appendChild(alternativeActions);
    installActions.append(els.installBundled, installAlternatives);
    var installNote = node('p', 'magpie-field-note', tr(
      '安装随 OpenBot 提供的 Magpie 插件。安装后会显示插件名称和依赖服务。',
      'Install the Magpie plugin bundled with OpenBot. The installed plugin and its required services will be shown.'
    ));
    install.append(installTitle, installActions, installNote);
    host.appendChild(install);

    var services = node('section', 'magpie-block');
    var servicesTitle = node('h4', '', tr('依赖服务', 'Required services'));
    servicesTitle.id = 'magpie-services-title';
    services.setAttribute('aria-labelledby', servicesTitle.id);
    els.services = node('ul', 'magpie-services');
    els.services.setAttribute('aria-live', 'polite');
    els.dependencyNote = node('p', 'magpie-field-note magpie-dependency-note');
    els.dependencyNote.hidden = true;
    services.appendChild(servicesTitle);
    services.appendChild(els.services);
    services.appendChild(els.dependencyNote);
    host.appendChild(services);

    var form = node('form', 'magpie-block magpie-config');
    form.id = 'magpie-config-form';
    form.noValidate = true;
    var configTitle = node('h4', '', tr('Magpie 网关', 'Magpie gateway'));
    configTitle.id = 'magpie-config-title';
    form.setAttribute('aria-labelledby', configTitle.id);
    var fields = node('div', 'magpie-fields');
    var gateway = labeled('label', 'magpie-gateway-url', '网关地址', 'Gateway URL');
    gateway.control.type = 'url';
    gateway.control.name = 'gatewayUrl';
    gateway.control.required = true;
    gateway.control.autocomplete = 'url';
    gateway.control.spellcheck = false;
    gateway.control.placeholder = tr('https://gateway.example.com', 'https://gateway.example.com');
    gateway.control.setAttribute('aria-describedby', 'magpie-gateway-note');
    els.gateway = gateway.control;
    var gatewayNote = node('span', 'magpie-field-note', tr('使用 Magpie 网关提供的地址。', 'Use the address provided by the Magpie gateway.'));
    gatewayNote.id = 'magpie-gateway-note';
    gateway.label.appendChild(gatewayNote);
    var key = labeled('label', 'magpie-api-key', 'API 密钥', 'API key');
    key.control.type = 'password';
    key.control.name = 'apiKey';
    key.control.autocomplete = 'new-password';
    key.control.spellcheck = false;
    key.control.placeholder = tr('留空以保留已保存的密钥', 'Leave blank to keep the saved key');
    key.control.setAttribute('aria-describedby', 'magpie-key-note');
    els.apiKey = key.control;
    var keyNote = node('span', 'magpie-field-note');
    keyNote.id = 'magpie-key-note';
    els.keyNote = keyNote;
    key.label.appendChild(keyNote);
    fields.append(gateway.label, key.label);
    form.append(configTitle, fields);
    els.configure = node('button', 'btn primary', tr('保存网关设置', 'Save gateway settings'));
    els.configure.type = 'submit';
    els.configure.id = 'magpie-configure';
    els.configure.dataset.magpieAction = 'configure';
    form.appendChild(els.configure);
    host.appendChild(form);

    var runtime = node('section', 'magpie-block');
    var runtimeTitle = node('h4', '', tr('服务控制', 'Service controls'));
    runtimeTitle.id = 'magpie-runtime-title';
    runtime.setAttribute('aria-labelledby', runtimeTitle.id);
    var runtimeActions = node('div', 'magpie-actions');
    els.enable = button('magpie-enable', tr('启用模型同步', 'Enable model sync'), 'primary', 'enable');
    els.disable = button('magpie-disable', tr('停用同步', 'Disable sync'), '', 'disable');
    els.sync = button('magpie-sync', tr('刷新模型', 'Refresh models'), '', 'sync');
    runtimeActions.append(els.enable, els.disable, els.sync);
    var runtimeNote = node('p', 'magpie-field-note', tr(
      '停用同步不会影响已创建的模型连接；它们仍会直接访问 Magpie 网关。',
      'Disabling sync does not affect existing model connections; they continue to access the Magpie gateway directly.'
    ));
    runtime.append(runtimeTitle, runtimeActions, runtimeNote);
    host.appendChild(runtime);

    var models = node('section', 'magpie-block magpie-models');
    var modelsHeading = node('div', 'magpie-model-heading');
    var modelsTitle = node('h4', '', tr('模型连接', 'Model connections'));
    modelsTitle.id = 'magpie-models-title';
    els.modelCount = node('span', 'magpie-field-note');
    modelsHeading.append(modelsTitle, els.modelCount);
    models.setAttribute('aria-labelledby', modelsTitle.id);
    var modelFields = node('div', 'magpie-model-fields');
    var modelLabel = node('label', 'magpie-field');
    var modelCaption = node('span', '', tr('选择 Magpie 模型', 'Select a Magpie model'));
    els.modelSelect = document.createElement('select');
    els.modelSelect.id = 'magpie-model-select';
    els.modelSelect.name = 'modelId';
    els.modelSelect.setAttribute('aria-describedby', 'magpie-model-note');
    modelLabel.htmlFor = els.modelSelect.id;
    modelLabel.append(modelCaption, els.modelSelect);
    els.modelNote = node('span', 'magpie-field-note');
    els.modelNote.id = 'magpie-model-note';
    modelLabel.appendChild(els.modelNote);
    els.useModel = button('magpie-use-model', tr('创建模型连接', 'Create model connection'), 'primary', 'use-model');
    modelFields.append(modelLabel, els.useModel);
    models.append(modelsHeading, modelFields);
    host.appendChild(models);

    els.refresh.addEventListener('click', refreshStatus);
    els.installBundled.addEventListener('click', function () { runAction('install', function () { return callApi('magpieInstall', [{ kind: 'bundled' }]); }, tr('正在安装 Magpie 插件…', 'Installing Magpie plugin…'), tr('Magpie 插件已安装。', 'Magpie plugin installed.')); });
    els.installFile.addEventListener('click', function () { runAction('install', function () { return callApi('magpieInstall', [{ kind: 'file' }]); }, tr('正在导入插件包…', 'Importing plugin package…'), tr('插件包已导入。', 'Plugin package imported.')); });
    els.installDirectory.addEventListener('click', function () { runAction('install', function () { return callApi('magpieInstall', [{ kind: 'directory' }]); }, tr('正在安装插件目录…', 'Installing plugin directory…'), tr('插件目录已安装。', 'Plugin directory installed.')); });
    form.addEventListener('submit', configureGateway);
    els.enable.addEventListener('click', function () { runAction('enable', function () { return callApi('magpieEnable'); }, tr('正在启用模型同步…', 'Enabling model sync…'), tr('模型同步已启用。', 'Model sync is enabled.')); });
    els.disable.addEventListener('click', function () { runAction('disable', function () { return callApi('magpieDisable'); }, tr('正在停用模型同步…', 'Disabling model sync…'), tr('模型同步已停用；已创建的模型连接仍直接访问 Magpie 网关。', 'Model sync is disabled. Existing model connections still access the Magpie gateway directly.')); });
    els.sync.addEventListener('click', function () { runAction('sync', function () { return callApi('magpieSync'); }, tr('正在刷新模型…', 'Refreshing models…'), tr('模型列表已刷新。', 'Model list refreshed.')); });
    els.useModel.addEventListener('click', useModel);

    renderStatus(null);
    message(apiMethod('magpieStatus')
      ? tr('打开此页时读取本机插件状态；不会自动启用插件。', 'Local plugin status is read when this page opens. The plugin is never enabled automatically.')
      : tr('此功能需要 OpenBot 桌面版。', 'This feature requires the OpenBot desktop app.'), apiMethod('magpieStatus') ? 'idle' : 'error');
    updateControls();
    subscribeStatusChanges();
    watchVisibility();
    return true;
  }

  function subscribeStatusChanges() {
    var subscribe = apiMethod('onMagpieChanged');
    if (!subscribe || state.unsubscribeChanges) return;
    try {
      var unsubscribe = subscribe.call(root.grokbot, handleStatusChanged);
      if (typeof unsubscribe === 'function') {
        state.unsubscribeChanges = unsubscribe;
        if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', unsubscribeStatusChanges, { once: true });
      }
    } catch (_) { state.unsubscribeChanges = null; }
  }

  function unsubscribeStatusChanges() {
    if (typeof state.unsubscribeChanges === 'function') {
      try { state.unsubscribeChanges(); } catch (_) { }
    }
    state.unsubscribeChanges = null;
  }

  function handleStatusChanged(payload) {
    if (!state.initialized) return;
    if (document.getElementById('magpie-status') !== els.status) {
      unsubscribeStatusChanges();
      return;
    }
    if (!payload || payload.ok !== true || !payload.status || typeof payload.status !== 'object') return;

    var gatewayDraft = els.gateway.value;
    var gatewayWasEdited = gatewayDraft !== state.baselineGateway;
    var apiKeyDraft = els.apiKey.value;
    var wasBusy = state.busy;
    var previousMessage = state.message;
    var previousMessageState = state.messageState;
    var status = payload.status;

    renderStatus(status);

    // Status events can arrive while the user is editing the form. Keep a
    // dirty gateway draft (including an intentionally cleared field) while
    // advancing the baseline to the new saved value.
    if (gatewayWasEdited) {
      els.gateway.value = gatewayDraft;
      if (typeof status.gatewayUrl === 'string') state.baselineGateway = status.gatewayUrl;
    }
    // The API key is never returned by status, so keep any unsaved input too.
    els.apiKey.value = apiKeyDraft;

    // A change notification updates status and controls, but should not hide
    // an in-flight action or a user-visible error. New status failures remain
    // authoritative and are shown by renderStatus.
    if (wasBusy || (previousMessageState === 'error' && !state.unsupported && status.state !== 'failed')) {
      message(previousMessage, previousMessageState);
    }
    updateControls();
  }

  function watchVisibility() {
    var panel = document.getElementById('set-panel-apps');
    var mask = document.getElementById('set-mask');
    if (!panel) return;
    var wasVisible = isVisible();
    if (wasVisible) refreshStatus();
    function onChange() {
      var visible = isVisible();
      if (visible && !wasVisible) refreshStatus();
      wasVisible = visible;
    }
    document.addEventListener('visibilitychange', onChange);
    if (typeof root.MutationObserver === 'function') {
      var observer = new root.MutationObserver(onChange);
      observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
      if (mask) observer.observe(mask, { attributes: true, attributeFilter: ['class', 'hidden'] });
    }
  }

  function isVisible() {
    var panel = document.getElementById('set-panel-apps');
    var mask = document.getElementById('set-mask');
    return !!(panel && !panel.hidden && mask && !mask.classList.contains('hidden') && !document.hidden);
  }

  function refreshStatus() {
    if (state.busy) return Promise.resolve();
    var read = apiMethod('magpieStatus');
    if (!read) {
      state.status = null;
      renderStatus(null);
      message(tr('此功能需要 OpenBot 桌面版。', 'This feature requires the OpenBot desktop app.'), 'error');
      updateControls();
      return Promise.resolve();
    }
    state.busy = true;
    message(tr('正在读取本机插件状态…', 'Reading local plugin status…'), 'pending');
    updateControls();
    return Promise.resolve().then(function () { return callApi('magpieStatus'); }).then(function (result) {
      applyResult(result, tr('插件状态已刷新。', 'Plugin status refreshed.'));
    }).catch(function (error) {
      showError(error);
    }).then(function () {
      state.busy = false;
      updateControls();
    });
  }

  function applyResult(result, fallbackMessage) {
    if (!result || result.ok !== true) {
      var error = new Error(result && (result.message || result.code) || tr('本机插件操作失败。', 'The local plugin action failed.'));
      error.code = result && result.code;
      throw error;
    }
    if (result.status && typeof result.status === 'object') {
      renderStatus(result.status);
      if (state.unsupported) return Promise.resolve();
      var backendMessage = localizedStatusMessage(result.status.message, stateSummary(result.status));
      if (backendMessage) message(backendMessage, result.status.state === 'failed' ? 'error' : 'idle');
      else message(fallbackMessage || '', 'ok');
      return Promise.resolve();
    }
    var read = apiMethod('magpieStatus');
    if (!read) {
      message(fallbackMessage || '', 'ok');
      return Promise.resolve();
    }
    return Promise.resolve().then(function () { return callApi('magpieStatus'); }).then(function (fresh) {
      if (!fresh || fresh.ok !== true) {
        throw new Error(fresh && (fresh.message || fresh.code) || tr('操作已完成，但无法读取最新状态。', 'The action completed, but the latest status could not be read.'));
      }
      renderStatus(fresh.status || null);
      if (!state.unsupported) {
        var summary = localizedStatusMessage(fresh.status && fresh.status.message, stateSummary(fresh.status));
        message(summary || fallbackMessage || '', fresh.status && fresh.status.state === 'failed' ? 'error' : 'ok');
      }
    });
  }

  function runAction(method, invoke, pendingText, successText) {
    if (state.busy) return Promise.resolve();
    if (!apiMethod(method === 'install' ? 'magpieInstall' : 'magpie' + method.charAt(0).toUpperCase() + method.slice(1))) {
      message(tr('此功能需要更新后的 OpenBot 桌面版。', 'This feature requires an updated OpenBot desktop app.'), 'error');
      return Promise.resolve();
    }
    state.busy = true;
    message(pendingText, 'pending');
    updateControls();
    return Promise.resolve().then(invoke).then(function (result) {
      return applyResult(result, successText);
    }).catch(function (error) {
      showError(error);
    }).then(function () {
      state.busy = false;
      if (method === 'configure') state.transientSecret = '';
      updateControls();
    });
  }

  function configureGateway(event) {
    event.preventDefault();
    if (state.busy) return;
    if (!apiMethod('magpieConfigure')) {
      message(tr('此功能需要更新后的 OpenBot 桌面版。', 'This feature requires an updated OpenBot desktop app.'), 'error');
      return;
    }
    var value = els.gateway.value.trim();
    if (!value || !els.gateway.checkValidity()) {
      message(tr('请输入有效的 Magpie 网关地址。', 'Enter a valid Magpie gateway URL.'), 'error');
      els.gateway.focus();
      if (typeof els.gateway.reportValidity === 'function') els.gateway.reportValidity();
      return;
    }
    var config = { gatewayUrl: value };
    if (els.apiKey.value) {
      config.apiKey = els.apiKey.value;
      state.transientSecret = els.apiKey.value;
    }
    runAction('configure', function () {
      var result = callApi('magpieConfigure', [config]);
      els.apiKey.value = '';
      state.baselineGateway = value;
      return result;
    }, tr('正在保存网关设置…', 'Saving gateway settings…'), tr('网关设置已保存。', 'Gateway settings saved.'));
  }

  function useModel() {
    var modelId = els.modelSelect.value;
    if (!modelId) {
      message(tr('请先刷新并选择一个 Magpie 模型。', 'Refresh models and select a Magpie model first.'), 'error');
      els.modelSelect.focus();
      return;
    }
    runAction('useModel', function () { return callApi('magpieUseModel', [{ modelId: modelId }]); },
      tr('正在创建模型连接…', 'Creating model connection…'), tr('模型连接已创建。', 'Model connection created.'));
  }

  function showError(error) {
    var code = String(error && error.code || '').toUpperCase();
    var key = code.replace(/^MAGPIE_/, '');
    var messages = {
      NOT_INSTALLED: ['请先安装 Magpie 插件。', 'Install the Magpie plugin first.'],
      UNSUPPORTED: ['此插件或版本不支持模型同步。请安装 Magpie 0.7.2。', 'This plugin or version does not support model sync. Install Magpie 0.7.2.'],
      RUNNING: ['请先停用模型同步，再更改插件或配置。', 'Disable model sync before changing the plugin or its configuration.'],
      URL: ['请输入有效的 Magpie 网关地址。', 'Enter a valid Magpie gateway URL.'],
      KEY: ['请检查 Magpie API 密钥。', 'Check the Magpie API key.'],
      CHANGED: ['插件文件已变化。请重新安装受支持的版本。', 'The plugin files changed. Reinstall the supported version.'],
      STORAGE: ['本机设置无法保存。请检查 OpenBot 私有配置目录。', 'Local settings could not be saved. Check OpenBot’s private configuration storage.'],
      REQUEST: ['Magpie 网关请求失败。请检查地址和 API 密钥后重试。', 'The Magpie gateway request failed. Check the URL and API key, then retry.'],
      STOPPED: ['模型同步已停止。请先启用同步再刷新模型。', 'Model sync is stopped. Enable sync before refreshing models.'],
      MODEL: ['无法创建模型连接。请刷新模型列表后重试。', 'Could not create the model connection. Refresh the model list and retry.'],
      CLOSED: ['已关闭选择器，没有进行更改。', 'The picker was closed. No changes were made.']
    };
    var detail = messages[key]
      ? tr(messages[key][0], messages[key][1])
      : localizedStatusMessage(error && error.message, tr('本机插件操作失败。', 'The local plugin action failed.')) || tr('本机插件操作失败。', 'The local plugin action failed.');
    message(secretSafe(detail), key === 'CLOSED' ? 'idle' : 'error');
  }

  function stateSummary(status) {
    if (!status) return '';
    if (status.state === 'failed') return tr('模型同步失败。请检查依赖服务并刷新状态。', 'Model sync failed. Check required services and refresh status.');
    if (status.state === 'pending' || status.state === 'starting') return tr('模型同步正在等待依赖服务。', 'Model sync is waiting for required services.');
    if (status.state === 'active') return tr('模型同步已运行。', 'Model sync is active.');
    if (status.state === 'stopped') return tr('模型同步已停止。', 'Model sync is stopped.');
    return '';
  }

  function stateLabel(value) {
      var key = statusToken(value);
    var labels = {
      active: ['ACTIVE · 运行中', 'ACTIVE'],
      pending: ['PENDING · 等待中', 'PENDING'],
      failed: ['FAILED · 失败', 'FAILED'],
      starting: ['STARTING · 启动中', 'STARTING'],
      stopped: ['STOPPED · 已停止', 'STOPPED']
    };
    return labels[key] ? tr(labels[key][0], labels[key][1]) : (key ? key.toUpperCase() : tr('未知', 'Unknown'));
  }

  function safeName(value) {
    return secretSafe(value).slice(0, 240);
  }

  function renderServices(services) {
    els.services.replaceChildren();
    if (!Array.isArray(services) || !services.length) {
      els.services.appendChild(node('li', 'magpie-services-empty', tr('暂无依赖服务信息。', 'No required services are reported.')));
      return;
    }
    services.forEach(function (service) {
      if (typeof service === 'string' || typeof service === 'number') service = { name: String(service), state: 'unknown' };
      else service = service && typeof service === 'object' ? service : {};
      var row = node('li', 'magpie-service');
      var firstLine = node('div', 'magpie-service-top');
      var name = node('strong', 'magpie-service-name', safeName(service.name || service.id || service.service || service.key || tr('未命名服务', 'Unnamed service')));
      var status = node('span', 'magpie-service-state', stateLabel(service.state));
      status.dataset.state = String(service.state || 'unknown').toLowerCase();
      firstLine.append(name, status);
      row.appendChild(firstLine);
      var missing = Array.isArray(service.missing) ? service.missing : (service.missing ? [service.missing] : []);
      if (missing.length) {
        var list = node('ul', 'magpie-missing');
        missing.forEach(function (item) {
          if (item && typeof item === 'object') item = item.message || item.name || item.id || item.code || '';
          var missingText = localizedStatusMessage(item, tr('缺少依赖项。', 'A required dependency is missing.'));
          var missingRow = node('li', 'magpie-missing-item');
          missingRow.append(
            node('strong', 'magpie-missing-label', tr('缺少：', 'Missing:')),
            node('span', 'magpie-missing-text', missingText)
          );
          list.appendChild(missingRow);
        });
        row.appendChild(list);
      }
      els.services.appendChild(row);
    });
  }

  function modelLabel(model) {
    var label = safeName(model.id);
    var details = [];
    if (typeof model.contextWindow === 'number' && isFinite(model.contextWindow)) details.push(tr('上下文 ', 'context ') + model.contextWindow);
    if (typeof model.maxTokens === 'number' && isFinite(model.maxTokens)) details.push(tr('最大输出 ', 'max output ') + model.maxTokens);
    return details.length ? label + ' — ' + details.join(' · ') : label;
  }

  function renderModels(models) {
    var selected = els.modelSelect.value;
    els.modelSelect.replaceChildren();
    if (!Array.isArray(models) || !models.length) {
      var empty = node('option', '', tr('尚无模型，请刷新模型列表', 'No models yet. Refresh the model list'));
      empty.value = '';
      els.modelSelect.appendChild(empty);
      els.modelSelect.value = '';
      els.modelCount.textContent = tr('0 个模型', '0 models');
      els.modelNote.textContent = tr('同步后可选择模型并创建连接。', 'Sync models to select one and create a connection.');
      return;
    }
    models.forEach(function (model) {
      model = model && typeof model === 'object' ? model : { id: model };
      var id = String(model.id == null ? '' : model.id);
      if (!id) return;
      var option = node('option', '', modelLabel(model));
      option.value = id;
      els.modelSelect.appendChild(option);
    });
    if (selected && Array.prototype.some.call(els.modelSelect.options, function (option) { return option.value === selected; })) els.modelSelect.value = selected;
    els.modelCount.textContent = tr('{count} 个模型', '{count} models', { count: models.length });
    els.modelNote.textContent = tr('选择模型后创建一条命名的模型连接。', 'Select a model to create a named model connection.');
  }

  function renderStatus(status) {
    state.status = status && typeof status === 'object' ? status : null;
    var installed = state.status && state.status.installed;
    var hasInstalled = !!installed;
    var name = hasInstalled ? String(installed.name || tr('未命名插件', 'Unnamed plugin')) : '';
    var isMagpie = hasInstalled && String(installed.name || '') === '@straydragon/dsh-x-magpie';
    var supportedVersion = hasInstalled && String(installed.version || '') === '0.7.2';
    var verifiedOriginal = hasInstalled && installed.verifiedOriginal === true;
    state.unsupported = hasInstalled && (!isMagpie || !supportedVersion || !verifiedOriginal);
    var overall = state.status && state.status.state;
    var overallText = !hasInstalled ? tr('尚未安装', 'Not installed') : state.unsupported
      ? tr('不支持的插件', 'Unsupported plugin') : stateLabel(overall || (state.status.enabled ? 'pending' : 'stopped'));
    els.status.textContent = overallText;
    els.status.dataset.state = state.unsupported ? 'setup' : String(overall || 'idle').toLowerCase();

    els.installed.textContent = hasInstalled
      ? tr('已安装：{name}{version}', 'Installed: {name}{version}', {
        name: safeName(name),
        version: installed.version ? ' · ' + safeName(installed.version) : ''
      })
      : tr('尚未安装本地插件。', 'No local plugin is installed.');
    els.installed.dataset.unsupported = state.unsupported ? 'true' : 'false';

    var services = state.status && Array.isArray(state.status.services) && state.status.services.length ? state.status.services
      : (installed && Array.isArray(installed.requiredServices) ? installed.requiredServices : []);
    renderServices(services);
    var evidence = statusToken((state.status && state.status.requiredServicesEvidence) || (installed && installed.requiredServicesEvidence));
    var dependencyState = statusToken((state.status && state.status.runtimeDependenciesStatus) || (installed && installed.runtimeDependenciesStatus));
    var dependencyNotes = [];
    if (evidence === 'unknown') dependencyNotes.push(tr('无法从插件元数据确认依赖服务。', 'Required services could not be verified from plugin metadata.'));
    else if (evidence === 'not-declared' || evidence === 'notdeclared' || evidence === 'not-declared-by-package') dependencyNotes.push(tr('已安装插件未声明依赖服务。', 'The installed plugin did not declare required services.'));
    if (dependencyState === 'not-resolved' || dependencyState === 'notresolved') dependencyNotes.push(tr('运行时依赖尚未解析。', 'Runtime dependencies have not been resolved.'));
    else if (dependencyState === 'none-declared' || dependencyState === 'nonedeclared') dependencyNotes.push(tr('插件未声明额外的运行时软件包依赖。', 'The plugin declares no additional runtime package dependencies.'));
    els.dependencyNote.textContent = dependencyNotes.join(' ');
    els.dependencyNote.hidden = !dependencyNotes.length;
    renderModels(state.status ? state.status.models : []);
    var gatewayValue = state.status && typeof state.status.gatewayUrl === 'string' ? state.status.gatewayUrl : '';
    if (!state.status || !gatewayValue || els.gateway.value === state.baselineGateway || !els.gateway.value) {
      els.gateway.value = gatewayValue;
      state.baselineGateway = gatewayValue;
    }
    var hasKey = !!(state.status && state.status.hasKey);
    els.keyNote.textContent = hasKey
      ? tr('已有密钥已保存。密钥不会显示在状态中；留空可保留。', 'A key is saved. It is never shown in status; leave blank to keep it.')
      : tr('密钥由桌面端安全保存，状态中只显示是否已配置。', 'The desktop app stores the key; status only shows whether one is configured.');
    if (state.unsupported) {
      var unsupportedText = isMagpie && supportedVersion && !verifiedOriginal
        ? tr('此插件内容尚未验证，未启用。', 'This plugin content has not been verified and is not enabled.')
        : isMagpie
          ? tr('此 Magpie 插件版本不受支持。仅已验证的 0.7.2 版本可启用模型同步。', 'This Magpie plugin version is unsupported. Only the verified 0.7.2 version can enable model sync.')
          : tr('当前安装的插件不支持 Magpie 集成。导入 Magpie 插件后才能启用模型同步。', 'The installed plugin does not support Magpie. Import a Magpie plugin to enable model sync.');
      message(unsupportedText, 'error');
    } else if (state.status && state.status.message) {
      var statusText = localizedStatusMessage(state.status.message, stateSummary(state.status));
      if (statusText) message(statusText, overall === 'failed' ? 'error' : 'idle');
    }
    updateControls();
  }

  function updateControls() {
    var hasStatusMethod = !!apiMethod('magpieStatus');
    var installed = !!(state.status && state.status.installed);
    var supported = installed && !state.unsupported;
    var enabled = !!(state.status && state.status.enabled);
    [els.refresh].forEach(function (item) { if (item) item.disabled = state.busy || !hasStatusMethod; });
    if (els.installBundled) els.installBundled.disabled = state.busy || !apiMethod('magpieInstall');
    if (els.installFile) els.installFile.disabled = state.busy || !apiMethod('magpieInstall');
    if (els.installDirectory) els.installDirectory.disabled = state.busy || !apiMethod('magpieInstall');
    if (els.gateway) els.gateway.disabled = state.busy || !supported;
    if (els.apiKey) els.apiKey.disabled = state.busy || !supported;
    if (els.configure) els.configure.disabled = state.busy || !supported || !apiMethod('magpieConfigure');
    if (els.enable) els.enable.disabled = state.busy || !supported || enabled || !apiMethod('magpieEnable');
    if (els.disable) els.disable.disabled = state.busy || !supported || !enabled || !apiMethod('magpieDisable');
    if (els.sync) els.sync.disabled = state.busy || !supported || !apiMethod('magpieSync');
    if (els.modelSelect) els.modelSelect.disabled = state.busy || !supported || !(state.status && state.status.models && state.status.models.length);
    if (els.useModel) els.useModel.disabled = state.busy || !supported || !els.modelSelect.value || !apiMethod('magpieUseModel');
    if (els.installed) els.installed.dataset.state = state.unsupported ? 'error' : (installed ? 'ok' : 'idle');
  }

  function start() {
    Promise.resolve(root.OpenBotI18n && root.OpenBotI18n.ready).then(build);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
