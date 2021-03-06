/*
 * Copyright 2015 Mirantis, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 **/
import $ from 'jquery';
import _ from 'underscore';
import i18n from 'i18n';
import Backbone from 'backbone';
import React from 'react';
import ReactDOM from 'react-dom';
import utils from 'utils';
import models from 'models';
import dispatcher from 'dispatcher';
import {CreateNodeNetworkGroupDialog, RemoveNodeNetworkGroupDialog} from 'views/dialogs';
import {backboneMixin, dispatcherMixin, unsavedChangesMixin, renamingMixin} from 'component_mixins';
import {Input, RadioGroup, Table} from 'views/controls';
import SettingSection from 'views/cluster_page_tabs/setting_section';
import CSSTransitionGroup from 'react-addons-transition-group';

var parametersNS = 'cluster_page.network_tab.networking_parameters.';
var networkTabNS = 'cluster_page.network_tab.';
var defaultNetworkSubtabs = ['neutron_l2', 'neutron_l3', 'network_settings', 'network_verification', 'nova_configuration'];

var NetworkModelManipulationMixin = {
  setValue(attribute, value, options) {
    function convertToStringIfNaN(value) {
      var convertedValue = parseInt(value, 10);
      return _.isNaN(convertedValue) ? '' : convertedValue;
    }
    if (options && options.isInteger && !_.isNull(value)) {
      // for ranges values
      if (_.isArray(value)) {
        value = _.map(value, convertToStringIfNaN);
      } else {
        value = convertToStringIfNaN(value);
      }
    }
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    this.getModel().set(attribute, value);
    dispatcher.trigger('hideNetworkVerificationResult');
    networkConfiguration.isValid();
  },
  getModel() {
    return this.props.network ||
      this.props.cluster.get('networkConfiguration').get('networking_parameters');
  }
};

var NetworkInputsMixin = {
  composeProps(attribute, isRange, isInteger) {
    var network = this.props.network;
    var ns = network ? networkTabNS + 'network.' : parametersNS;
    var error = this.getError(attribute) || null;

    // in case of verification error we need to pass an empty string to highlight the field only
    // but not overwriting validation error
    if (!error && _.contains(this.props.verificationErrorField, attribute)) {
      error = '';
    }
    return {
      key: attribute,
      onChange: _.partialRight(this.setValue, {isInteger: isInteger}),
      disabled: this.props.disabled,
      name: attribute,
      label: i18n(ns + attribute),
      value: this.getModel().get(attribute),
      network: network,
      cluster: this.props.cluster,
      wrapperClassName: isRange ? attribute : false,
      error: error
    };
  },
  renderInput(attribute, isInteger, additionalProps = {}) {
    return (
      <Input
        {...additionalProps}
        {...this.composeProps(attribute, false, isInteger)}
        type='text'
        wrapperClassName={attribute}
      />
    );
  },
  getError(attribute) {
    var validationError = this.props.cluster.get('networkConfiguration').validationError;
    if (!validationError) return null;

    var error;
    if (this.props.network) {
      try {
        error = validationError.networks[this.props.currentNodeNetworkGroup.id][this.props.network.id][attribute];
      } catch (e) {}
      return error || null;
    }
    error = (validationError.networking_parameters || {})[attribute];
    if (!error) return null;

    // specific format needed for vlan_start error
    if (attribute == 'fixed_networks_vlan_start') return [error];

    return error;
  }
};

var Range = React.createClass({
  mixins: [
    NetworkModelManipulationMixin
  ],
  getDefaultProps() {
    return {
      extendable: true,
      placeholder: '127.0.0.1',
      hiddenControls: false
    };
  },
  propTypes: {
    wrapperClassName: React.PropTypes.node,
    extendable: React.PropTypes.bool,
    name: React.PropTypes.string,
    autoIncreaseWith: React.PropTypes.number,
    integerValue: React.PropTypes.bool,
    placeholder: React.PropTypes.string,
    hiddenControls: React.PropTypes.bool,
    mini: React.PropTypes.bool
  },
  getInitialState() {
    return {elementToFocus: null};
  },
  componentDidUpdate() {
    // this glitch is needed to fix
    // when pressing '+' or '-' buttons button remains focused
    if (this.props.extendable && this.state.elementToFocus && this.getModel().get(this.props.name).length) {
      $(this.refs[this.state.elementToFocus].getInputDOMNode()).focus();
      this.setState({elementToFocus: null});
    }
  },
  autoCompleteIPRange(error, rangeStart, event) {
    var input = event.target;
    if (input.value) return;
    if (_.isUndefined(error)) input.value = rangeStart;
    if (input.setSelectionRange) {
      var startPos = _.lastIndexOf(rangeStart, '.') + 1;
      var endPos = rangeStart.length;
      input.setSelectionRange(startPos, endPos);
    }
  },
  onRangeChange(name, newValue, attribute, rowIndex) {
    var model = this.getModel();
    var valuesToSet = _.cloneDeep(model.get(attribute));
    var valuesToModify = this.props.extendable ? valuesToSet[rowIndex] : valuesToSet;

    if (this.props.autoIncreaseWith) {
      valuesToSet = newValue;
    } else if (_.contains(name, 'range-start')) {
      // if first range field
      valuesToModify[0] = newValue;
    } else if (_.contains(name, 'range-end')) {
      // if end field
      valuesToModify[1] = newValue;
    }

    this.setValue(attribute, valuesToSet, {isInteger: this.props.integerValue});
  },
  addRange(attribute, rowIndex) {
    var newValue = _.clone(this.getModel().get(attribute));
    newValue.splice(rowIndex + 1, 0, ['', '']);
    this.setValue(attribute, newValue);
    this.setState({
      elementToFocus: 'start' + (rowIndex + 1)
    });
  },
  removeRange(attribute, rowIndex) {
    var newValue = _.clone(this.getModel().get(attribute));
    newValue.splice(rowIndex, 1);
    this.setValue(attribute, newValue);
    this.setState({
      elementToFocus: 'start' + _.min([newValue.length - 1, rowIndex])
    });
  },
  getRangeProps(isRangeEnd) {
    var error = this.props.error || null;
    var attributeName = this.props.name;
    return {
      type: 'text',
      placeholder: error ? '' : this.props.placeholder,
      className: 'form-control',
      disabled: this.props.disabled,
      onChange: _.partialRight(this.onRangeChange, attributeName),
      name: (isRangeEnd ? 'range-end_' : 'range-start_') + attributeName
    };
  },
  renderRangeControls(attributeName, index, length) {
    return (
      <div className='ip-ranges-control'>
        <button
          className='btn btn-link ip-ranges-add'
          disabled={this.props.disabled}
          onClick={_.partial(this.addRange, attributeName, index)}
        >
          <i className='glyphicon glyphicon-plus-sign'></i>
        </button>
        {(length > 1) &&
          <button
            className='btn btn-link ip-ranges-delete'
            disabled={this.props.disabled}
            onClick={_.partial(this.removeRange, attributeName, index)}
          >
            <i className='glyphicon glyphicon-minus-sign'></i>
          </button>
        }
      </div>
    );
  },
  render() {
    var error = this.props.error || null;
    var attributeName = this.props.name;
    var attribute = this.getModel().get(attributeName);
    var ranges = this.props.autoIncreaseWith ?
      [attribute || 0, (attribute + this.props.autoIncreaseWith - 1 || 0)] :
      attribute;
    var wrapperClasses = {
      'form-group range row': true,
      mini: this.props.mini,
      [this.props.wrapperClassName]: this.props.wrapperClassName
    };
    var verificationError = this.props.verificationError || null;
    var [startInputError, endInputError] = error || [];

    wrapperClasses[this.props.wrapperClassName] = this.props.wrapperClassName;
    return (
      <div className={utils.classNames(wrapperClasses)}>
        {!this.props.hiddenHeader &&
          <div className='range-row-header col-xs-12'>
            <div>{i18n(networkTabNS + 'range_start')}</div>
            <div>{i18n(networkTabNS + 'range_end')}</div>
          </div>
        }
        <div className='col-xs-12'>
          <label>{this.props.label}</label>
          {this.props.extendable ?
            _.map(ranges, (range, index) => {
              var rangeError = _.findWhere(error, {index: index}) || {};
              return (
                <div className='range-row clearfix' key={index}>
                  <Input
                    {...this.getRangeProps()}
                    error={(rangeError.start || verificationError) ? '' : null}
                    value={range[0]}
                    onChange={_.partialRight(this.onRangeChange, attributeName, index)}
                    ref={'start' + index}
                    inputClassName='start'
                    placeholder={rangeError.start ? '' : this.props.placeholder}
                  />
                  <Input
                    {...this.getRangeProps(true)}
                    error={rangeError.end ? '' : null}
                    value={range[1]}
                    onChange={_.partialRight(this.onRangeChange, attributeName, index)}
                    onFocus={_.partial(this.autoCompleteIPRange, rangeError && rangeError.start, range[0])}
                    disabled={this.props.disabled || !!this.props.autoIncreaseWith}
                    placeholder={rangeError.end ? '' : this.props.placeholder}
                    extraContent={!this.props.hiddenControls && this.renderRangeControls(attributeName, index, ranges.length)}
                  />
                  <div className='validation-error text-danger pull-left'>
                    <span className='help-inline'>
                      {rangeError.start || rangeError.end}
                    </span>
                  </div>
                </div>
              );
            })
          :
            <div className='range-row clearfix'>
              <Input
                {...this.getRangeProps()}
                value={ranges[0]}
                error={startInputError ? '' : null}
                inputClassName='start'
              />
              <Input
                {...this.getRangeProps(true)}
                disabled={this.props.disabled || !!this.props.autoIncreaseWith}
                value={ranges[1]}
                error={endInputError ? '' : null}
              />
              {error && (startInputError || endInputError) &&
                <div className='validation-error text-danger pull-left'>
                  <span className='help-inline'>{startInputError || endInputError}</span>
                </div>
              }
            </div>
          }
        </div>
      </div>
    );
  }
});

var VlanTagInput = React.createClass({
  mixins: [NetworkModelManipulationMixin],
  getInitialState() {
    return {pendingFocus: false};
  },
  componentDidUpdate() {
    var value = this.props.value;
    if (!_.isNull(value) && this.state.pendingFocus) {
      $(this.refs[this.props.name].getInputDOMNode()).focus();
      this.setState({pendingFocus: false});
    }
  },
  onTaggingChange(attribute, value) {
    this.setValue(attribute, value ? '' : null);
    this.setState({pendingFocus: true});
  },
  onInputChange(attribute, value) {
    this.setValue(attribute, value, {isInteger: true});
  },
  render() {
    return (
      <div className={'vlan-tagging form-group ' + this.props.name}>
        <label className='vlan-tag-label'>{this.props.label}</label>
        <Input {...this.props}
          onChange={this.onTaggingChange}
          type='checkbox'
          checked={!_.isNull(this.props.value)}
          error={null}
          label={null}
        />
        {!_.isNull(this.props.value) &&
          <Input {...this.props}
            ref={this.props.name}
            onChange={this.onInputChange}
            type='text'
            label={null}
          />
        }
      </div>
    );
  }
});

var CidrControl = React.createClass({
  mixins: [NetworkModelManipulationMixin],
  onCidrChange(name, cidr) {
    this.props.onChange(name, cidr);
    if (this.props.network.get('meta').notation == 'cidr') {
      this.props.autoUpdateParameters(cidr);
    }
  },
  render() {
    return (
      <div className='form-group cidr'>
        <label>{i18n(networkTabNS + 'network.cidr')}</label>
        <Input
          {...this.props}
          type='text'
          label={null}
          onChange={this.onCidrChange}
          wrapperClassName='pull-left'
        />
        <Input
          type='checkbox'
          checked={this.props.network.get('meta').notation == 'cidr'}
          label={i18n(networkTabNS + 'network.use_whole_cidr')}
          disabled={this.props.disabled}
          onChange={this.props.changeNetworkNotation}
          wrapperClassName='pull-left'
        />
      </div>
    );
  }
});

// FIXME(morale): this component is a lot of copy-paste from Range component
// and should be rewritten either as a mixin or as separate component for
// multiplying other components (eg accepting Range, Input etc)
var MultipleValuesInput = React.createClass({
  mixins: [
    NetworkModelManipulationMixin
  ],
  propTypes: {
    name: React.PropTypes.string,
    placeholder: React.PropTypes.string,
    label: React.PropTypes.string,
    value: React.PropTypes.array
  },
  getInitialState() {
    return {elementToFocus: null};
  },
  componentDidUpdate() {
    // this glitch is needed to fix
    // when pressing '+' or '-' buttons button remains focused
    if (this.state.elementToFocus && this.getModel().get(this.props.name).length) {
      $(this.refs[this.state.elementToFocus].getInputDOMNode()).focus();
      this.setState({elementToFocus: null});
    }
  },
  onChange(attribute, value, index) {
    var model = this.getModel();
    var valueToSet = _.cloneDeep(model.get(attribute));
    valueToSet[index] = value;
    this.setValue(attribute, valueToSet);
  },
  addValue(attribute, index) {
    var newValue = _.clone(this.getModel().get(attribute));
    newValue.splice(index + 1, 0, '');
    this.setValue(attribute, newValue);
    this.setState({
      elementToFocus: 'row' + (index + 1)
    });
  },
  removeValue(attribute, index) {
    var newValue = _.clone(this.getModel().get(attribute));
    newValue.splice(index, 1);
    this.setValue(attribute, newValue);
    this.setState({
      elementToFocus: 'row' + _.min([newValue.length - 1, index])
    });
  },
  renderControls(attributeName, index, length) {
    return (
      <div className='ip-ranges-control'>
        <button
          className='btn btn-link ip-ranges-add'
          disabled={this.props.disabled}
          onClick={_.partial(this.addValue, attributeName, index)}
        >
          <i className='glyphicon glyphicon-plus-sign' />
        </button>
        {length > 1 &&
          <button
            className='btn btn-link ip-ranges-delete'
            disabled={this.props.disabled}
            onClick={_.partial(this.removeValue, attributeName, index)}
          >
            <i className='glyphicon glyphicon-minus-sign' />
          </button>
        }
      </div>
    );
  },
  render() {
    var attributeName = this.props.name;
    var values = this.props.value;
    return (
      <div className={'form-group row multiple-values ' + attributeName}>
        <div className='col-xs-12'>
          <label>{this.props.label}</label>
          {_.map(values, (value, index) => {
            var inputError = (this.props.error || {})[index];
            return (
              <div className='range-row clearfix' key={attributeName + index}>
                <Input
                  type='text'
                  disabled={this.props.disabled}
                  name={attributeName}
                  error={(inputError || this.props.verificationError) && ''}
                  value={value}
                  onChange={_.partialRight(this.onChange, index)}
                  ref={'row' + index}
                  placeholder={inputError ? '' : this.props.placeholder}
                  extraContent={this.renderControls(attributeName, index, values.length)}
                />
                <div className='validation-error text-danger pull-left'>{inputError}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
});

var NetworkTab = React.createClass({
  mixins: [
    NetworkInputsMixin,
    NetworkModelManipulationMixin,
    backboneMixin('cluster', 'change:status'),
    backboneMixin('nodeNetworkGroups', 'change update'),
    backboneMixin({
      modelOrCollection(props) {
        return props.cluster.get('networkConfiguration').get('networking_parameters');
      },
      renderOn: 'change'
    }),
    backboneMixin({
      modelOrCollection(props) {
        return props.cluster.get('networkConfiguration').get('networks');
      },
      renderOn: 'change reset update'
    }),
    backboneMixin({
      modelOrCollection(props) {
        return props.cluster.get('tasks');
      },
      renderOn: 'update change:status'
    }),
    dispatcherMixin('hideNetworkVerificationResult', function() {
      this.setState({hideVerificationResult: true});
    }),
    dispatcherMixin('networkConfigurationUpdated', function() {
      this.setState({hideVerificationResult: false});
    }),
    backboneMixin({
      modelOrCollection(props) {
        return props.cluster.get('settings');
      },
      renderOn: 'change invalid'
    }),
    unsavedChangesMixin
  ],
  statics: {
    fetchData(options) {
      var cluster = options.cluster;
      return $.when(
        cluster.get('settings').fetch({cache: true}),
        cluster.get('networkConfiguration').fetch({cache: true})
      ).then(() => ({}));
    }
  },
  getInitialState() {
    var settings = this.props.cluster.get('settings');
    return {
      configModels: {
        cluster: this.props.cluster,
        settings: settings,
        networking_parameters: this.props.cluster.get('networkConfiguration').get('networking_parameters'),
        version: app.version,
        release: this.props.cluster.get('release'),
        default: settings
      },
      initialSettingsAttributes: _.cloneDeep(settings.attributes),
      settingsForChecks: new models.Settings(_.cloneDeep(settings.attributes)),
      initialConfiguration: _.cloneDeep(this.props.cluster.get('networkConfiguration').toJSON()),
      hideVerificationResult: false
    };
  },
  componentDidMount() {
    this.props.cluster.get('networkConfiguration').isValid();
    this.props.cluster.get('settings').isValid({models: this.state.configModels});
    this.props.cluster.get('tasks').on('change:status change:unsaved', this.destroyUnsavedNetworkVerificationTask, this);
  },
  componentWillUnmount() {
    this.loadInitialConfiguration();
    this.props.cluster.get('tasks').off(null, this.destroyUnsavedNetworkVerificationTask, this);
    this.removeUnsavedTasks();
  },
  destroyUnsavedNetworkVerificationTask(task) {
    // FIXME(vkramskikh): remove tasks which we marked as "unsaved" hacky flag
    // immediately after completion, so they won't be taken into account when
    // we determine cluster verification status. They need to be removed silently
    // and kept in the collection to show verification result to the user
    if (task.match({group: 'network', active: false}) && task.get('unsaved')) {
      task.destroy({silent: true});
      task.unset('id'); // hack to prevent issuing another DELETE requests after actual removal
      this.props.cluster.get('tasks').add(task, {silent: true});
    }
  },
  removeUnsavedTasks() {
    var clusterTasks = this.props.cluster.get('tasks');
    clusterTasks.each((task) => task.get('unsaved') && clusterTasks.remove(task));
  },
  isNetworkConfigurationChanged() {
    return !_.isEqual(this.state.initialConfiguration, this.props.cluster.get('networkConfiguration').toJSON());
  },
  isNetworkSettingsChanged() {
    return this.props.cluster.get('settings').hasChanges(this.state.initialSettingsAttributes, this.state.configModels);
  },
  hasChanges() {
    return this.isNetworkConfigurationChanged() || this.isNetworkSettingsChanged();
  },
  revertChanges() {
    this.loadInitialConfiguration();
    this.loadInitialSettings();
    this.setState({
      hideVerificationResult: true,
      key: _.now()
    });
  },
  loadInitialConfiguration() {
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    networkConfiguration.get('networks').reset(_.cloneDeep(this.state.initialConfiguration.networks));
    networkConfiguration.get('networking_parameters').set(_.cloneDeep(this.state.initialConfiguration.networking_parameters));
  },
  loadInitialSettings() {
    var settings = this.props.cluster.get('settings');
    settings.set(_.cloneDeep(this.state.initialSettingsAttributes), {silent: true, validate: false});
    settings.mergePluginSettings();
    settings.isValid({models: this.state.configModels});
  },
  updateInitialConfiguration() {
    this.setState({initialConfiguration: _.cloneDeep(this.props.cluster.get('networkConfiguration').toJSON())});
  },
  isLocked() {
    return !!this.props.cluster.task({group: ['deployment', 'network'], active: true}) ||
      !this.props.cluster.isAvailableForSettingsChanges() || this.state.actionInProgress;
  },
  prepareIpRanges() {
    var removeEmptyRanges = (ranges) => {
      return _.filter(ranges, (range) => _.compact(range).length);
    };
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    networkConfiguration.get('networks').each((network) => {
      if (network.get('meta').notation == 'ip_ranges') {
        network.set({ip_ranges: removeEmptyRanges(network.get('ip_ranges'))});
      }
    });
    var floatingRanges = networkConfiguration.get('networking_parameters').get('floating_ranges');
    if (floatingRanges) {
      networkConfiguration.get('networking_parameters').set({floating_ranges: removeEmptyRanges(floatingRanges)});
    }
  },
  onManagerChange(name, value) {
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    var networkingParameters = networkConfiguration.get('networking_parameters');
    var fixedAmount = networkConfiguration.get('networking_parameters').get('fixed_networks_amount') || 1;
    networkingParameters.set({
      net_manager: value,
      fixed_networks_amount: value == 'FlatDHCPManager' ? 1 : fixedAmount
    });
    networkConfiguration.isValid();
    this.setState({hideVerificationResult: true});
  },
  verifyNetworks() {
    this.setState({actionInProgress: true});
    this.prepareIpRanges();
    dispatcher.trigger('networkConfigurationUpdated', this.startVerification);
  },
  startVerification() {
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    var task = new models.Task();
    var options = {
      method: 'PUT',
      url: _.result(networkConfiguration, 'url') + '/verify',
      data: JSON.stringify(networkConfiguration)
    };
    var ns = networkTabNS + 'verify_networks.verification_error.';

    task.save({}, options)
      .fail((response) => {
        utils.showErrorDialog({
          title: i18n(ns + 'title'),
          message: i18n(ns + 'start_verification_warning'),
          response: response
        });
      })
      .then(() => {
        return this.props.cluster.fetchRelated('tasks');
      })
      .then(() => {
        // FIXME(vkramskikh): this ugly hack is needed to distinguish
        // verification tasks for saved config from verification tasks
        // for unsaved config (which appear after clicking "Verify"
        // button without clicking "Save Changes" button first).
        // For proper implementation, this should be managed by backend
        this.props.cluster.get('tasks').get(task.id).set('unsaved', this.hasChanges());
        dispatcher.trigger('networkVerificationTaskStarted');
        return $.Deferred().resolve();
      })
      .always(() => {
        this.setState({actionInProgress: false});
      });
  },
  isDiscardingPossible() {
    return !this.props.cluster.task({group: 'network', active: true});
  },
  applyChanges() {
    if (!this.isSavingPossible()) return $.Deferred().reject();
    this.setState({actionInProgress: true});
    this.prepareIpRanges();

    var requests = [];
    var result = $.Deferred();

    dispatcher.trigger('networkConfigurationUpdated', () => {
      return Backbone.sync('update', this.props.cluster.get('networkConfiguration'))
        .then((response) => {
          this.updateInitialConfiguration();
          result.resolve(response);
        }, (response) => {
          result.reject();
          return this.props.cluster.fetchRelated('tasks')
            .done(() => {
              // FIXME (morale): this hack is needed until backend response
              // format is unified https://bugs.launchpad.net/fuel/+bug/1521661
              var checkNetworksTask = this.props.cluster.task('check_networks');
              if (!(checkNetworksTask && checkNetworksTask.get('message'))) {
                var fakeTask = new models.Task({
                  cluster: this.props.cluster.id,
                  message: utils.getResponseText(response),
                  status: 'error',
                  name: 'check_networks',
                  result: {}
                });
                this.props.cluster.get('tasks').remove(checkNetworksTask);
                this.props.cluster.get('tasks').add(fakeTask);
              }
              // FIXME(vkramskikh): the same hack for check_networks task:
              // remove failed tasks immediately, so they won't be taken into account
              this.props.cluster.task('check_networks').set('unsaved', true);
            });
        })
        .always(() => {
          this.setState({actionInProgress: false});
        });
    });
    requests.push(result);

    if (this.isNetworkSettingsChanged()) {
      // collecting data to save
      var settings = this.props.cluster.get('settings');
      var dataToSave = this.props.cluster.isAvailableForSettingsChanges() ? settings.attributes :
        _.pick(settings.attributes, (group) => (group.metadata || {}).always_editable);

      var options = {url: settings.url, patch: true, wait: true, validate: false};
      var deferred = new models.Settings(_.cloneDeep(dataToSave)).save(null, options);
      if (deferred) {
        this.setState({actionInProgress: true});
        deferred
          .done(() => this.setState({initialSettingsAttributes: _.cloneDeep(settings.attributes)}))
          .always(() => {
            this.setState({
              actionInProgress: false,
              key: _.now()
            });
            this.props.cluster.fetch();
          })
          .fail((response) => {
            utils.showErrorDialog({
              title: i18n('cluster_page.settings_tab.settings_error.title'),
              message: i18n('cluster_page.settings_tab.settings_error.saving_warning'),
              response: response
            });
          });

        requests.push(deferred);
      }
    }

    return $.when(...requests);
  },
  isSavingPossible() {
    return !this.state.actionInProgress &&
      this.props.cluster.isAvailableForSettingsChanges() &&
      this.hasChanges() &&
      _.isNull(this.props.cluster.get('networkConfiguration').validationError) &&
      _.isNull(this.props.cluster.get('settings').validationError);
  },
  renderButtons() {
    var isCancelChangesDisabled = this.state.actionInProgress || !!this.props.cluster.task({group: 'deployment', active: true}) || !this.hasChanges();
    return (
      <div className='well clearfix'>
        <div className='btn-group pull-right'>
          <button
            key='revert_changes'
            className='btn btn-default btn-revert-changes'
            onClick={this.revertChanges}
            disabled={isCancelChangesDisabled}
          >
            {i18n('common.cancel_changes_button')}
          </button>
          <button
            key='apply_changes'
            className='btn btn-success apply-btn'
            onClick={this.applyChanges}
            disabled={!this.isSavingPossible()}
          >
            {i18n('common.save_settings_button')}
          </button>
        </div>
      </div>
    );
  },
  getVerificationErrors() {
    var task = this.state.hideVerificationResult ? null : this.props.cluster.task({group: 'network', status: 'error'});
    var fieldsWithVerificationErrors = [];
    // @TODO(morale): soon response format will be changed and this part should be rewritten
    if (task && task.get('result').length) {
      _.each(task.get('result'), (verificationError) => {
        _.each(verificationError.ids, (networkId) => {
          _.each(verificationError.errors, (field) => {
            fieldsWithVerificationErrors.push({network: networkId, field: field});
          });
        });
      });
    }
    return fieldsWithVerificationErrors;
  },
  removeNodeNetworkGroup() {
    var nodeNetworkGroup = this.nodeNetworkGroups.find({name: this.props.activeNetworkSectionName});
    RemoveNodeNetworkGroupDialog
      .show({
        showUnsavedChangesWarning: this.hasChanges()
      })
      .done(() => {
        this.props.setActiveNetworkSectionName(this.nodeNetworkGroups.find({is_default: true}).get('name'));
        return nodeNetworkGroup
          .destroy({wait: true})
          .then(
            () => this.props.cluster.get('networkConfiguration').fetch(),
            (response) => utils.showErrorDialog({
              title: i18n(networkTabNS + 'node_network_group_deletion_error'),
              response: response
            })
          )
          .then(this.updateInitialConfiguration);
      });
  },
  addNodeNetworkGroup(hasChanges) {
    if (hasChanges) {
      utils.showErrorDialog({
        title: i18n(networkTabNS + 'node_network_group_creation_error'),
        message: <div><i className='glyphicon glyphicon-danger-sign' /> {i18n(networkTabNS + 'save_changes_warning')}</div>
      });
      return;
    }
    CreateNodeNetworkGroupDialog
      .show({
        clusterId: this.props.cluster.id,
        nodeNetworkGroups: this.nodeNetworkGroups
      })
      .done(() => {
        this.setState({hideVerificationResult: true});
        return this.nodeNetworkGroups.fetch()
          .then(() => {
            var newNodeNetworkGroup = this.nodeNetworkGroups.last();
            this.props.nodeNetworkGroups.add(newNodeNetworkGroup);
            this.props.setActiveNetworkSectionName(newNodeNetworkGroup.get('name'));
            return this.props.cluster.get('networkConfiguration').fetch();
          })
          .then(this.updateInitialConfiguration);
      });
  },
  render() {
    var isLocked = this.isLocked();
    var hasChanges = this.hasChanges();
    var {activeNetworkSectionName, cluster} = this.props;
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    var networkingParameters = networkConfiguration.get('networking_parameters');
    var manager = networkingParameters.get('net_manager');
    var managers = [
      {
        label: i18n(networkTabNS + 'flatdhcp_manager'),
        data: 'FlatDHCPManager',
        checked: manager == 'FlatDHCPManager',
        disabled: isLocked
      },
      {
        label: i18n(networkTabNS + 'vlan_manager'),
        data: 'VlanManager',
        checked: manager == 'VlanManager',
        disabled: isLocked
      }
    ];
    var classes = {
      row: true,
      'changes-locked': isLocked
    };
    var nodeNetworkGroups = this.nodeNetworkGroups = new models.NodeNetworkGroups(this.props.nodeNetworkGroups.where({cluster_id: cluster.id}));
    var isNovaEnvironment = cluster.get('net_provider') == 'nova_network';
    var networks = networkConfiguration.get('networks');
    var isMultiRack = nodeNetworkGroups.length > 1;
    var networkVerifyTask = cluster.task('verify_networks');
    var networkCheckTask = cluster.task('check_networks');

    var {validationError} = networkConfiguration;
    var notEnoughOnlineNodesForVerification = cluster.get('nodes').where({online: true}).length < 2;
    var isVerificationDisabled = validationError ||
      this.state.actionInProgress ||
      !!cluster.task({group: ['deployment', 'network'], active: true}) ||
      isMultiRack ||
      notEnoughOnlineNodesForVerification;

    var currentNodeNetworkGroup = nodeNetworkGroups.findWhere({name: activeNetworkSectionName});
    var nodeNetworkGroupProps = {
      cluster: cluster,
      locked: isLocked,
      actionInProgress: this.state.actionInProgress,
      verificationErrors: this.getVerificationErrors(),
      validationError: validationError
    };

    return (
      <div className={utils.classNames(classes)}>
        <div className='col-xs-12'>
          <div className='row'>
            <div className='title col-xs-7'>
              {i18n(networkTabNS + 'title')}
              {!isNovaEnvironment &&
                <div className='forms-box segmentation-type'>
                  {'(' + i18n('common.network.neutron_' +
                    networkingParameters.get('segmentation_type')) + ')'}
                </div>
              }
            </div>
            <div className='col-xs-5 node-network-groups-controls'>
              {!isNovaEnvironment &&
                <button
                  key='add_node_group'
                  className='btn btn-default add-nodegroup-btn pull-right'
                  onClick={_.partial(this.addNodeNetworkGroup, hasChanges)}
                  disabled={!!cluster.task({group: ['deployment', 'network'], active: true}) || this.state.actionInProgress}
                >
                  {hasChanges && <i className='glyphicon glyphicon-danger-sign'/>}
                  {i18n(networkTabNS + 'add_node_network_group')}
                </button>
              }
            </div>
          </div>
        </div>
        {isNovaEnvironment &&
          <div className='col-xs-12 forms-box nova-managers'>
            <RadioGroup
              key='net_provider'
              name='net_provider'
              values={managers}
              onChange={this.onManagerChange}
              wrapperClassName='pull-left'
            />
          </div>
        }
        <div className='network-tab-content col-xs-12'>
          <div className='row'>
            <NetworkSubtabs
              cluster={cluster}
              validationError={validationError}
              setActiveNetworkSectionName={this.props.setActiveNetworkSectionName}
              nodeNetworkGroups={nodeNetworkGroups}
              activeGroupName={activeNetworkSectionName}
              isMultiRack={isMultiRack}
              hasChanges={hasChanges}
              showVerificationResult={!this.state.hideVerificationResult}
            />
            <div className='col-xs-10'>
              {!_.contains(defaultNetworkSubtabs, activeNetworkSectionName) &&
                <NodeNetworkGroup
                  {...nodeNetworkGroupProps}
                  nodeNetworkGroups={nodeNetworkGroups}
                  nodeNetworkGroup={currentNodeNetworkGroup}
                  networks={networks.where({group_id: currentNodeNetworkGroup.id})}
                  removeNodeNetworkGroup={this.removeNodeNetworkGroup}
                  setActiveNetworkSectionName={this.props.setActiveNetworkSectionName}
                />
              }
              {activeNetworkSectionName == 'network_settings' &&
                <NetworkSettings
                  {... _.pick(this.state, 'key', 'configModels', 'settingsForChecks')}
                  cluster={this.props.cluster}
                  locked={this.state.actionInProgress}
                  initialAttributes={this.state.initialSettingsAttributes}
                />
              }
              {activeNetworkSectionName == 'network_verification' &&
                <NetworkVerificationResult
                  key='network_verification'
                  task={networkVerifyTask}
                  networks={networks}
                  hideVerificationResult={this.state.hideVerificationResult}
                  isMultirack={isMultiRack}
                  isVerificationDisabled={isVerificationDisabled}
                  notEnoughNodes={notEnoughOnlineNodesForVerification}
                  verifyNetworks={this.verifyNetworks}
                />
              }
              {activeNetworkSectionName == 'nova_configuration' &&
                <NovaParameters
                  cluster={cluster}
                  validationError={validationError}
                />
              }
              {activeNetworkSectionName == 'neutron_l2' &&
                <NetworkingL2Parameters
                  cluster={cluster}
                  validationError={validationError}
                  disabled={this.isLocked()}
                />
              }
              {activeNetworkSectionName == 'neutron_l3' &&
                <NetworkingL3Parameters
                  cluster={cluster}
                  validationError={validationError}
                  disabled={this.isLocked()}
                />
              }
            </div>
          </div>
        </div>
        {!this.state.hideVerificationResult && networkCheckTask && networkCheckTask.match({status: 'error'}) &&
          <div className='col-xs-12'>
            <div className='alert alert-danger enable-selection col-xs-12 network-alert'>
              {utils.renderMultilineText(networkCheckTask.get('message'))}
            </div>
          </div>
        }
        <div className='col-xs-12 page-buttons content-elements'>
          {this.renderButtons()}
        </div>
      </div>
    );
  }
});

var NodeNetworkGroup = React.createClass({
  render() {
    var {cluster, networks, nodeNetworkGroup, nodeNetworkGroups, verificationErrors, validationError} = this.props;
    return (
      <div>
        <NodeNetworkGroupTitle
          nodeNetworkGroups={nodeNetworkGroups}
          currentNodeNetworkGroup={nodeNetworkGroup}
          removeNodeNetworkGroup={this.props.removeNodeNetworkGroup}
          setActiveNetworkSectionName={this.props.setActiveNetworkSectionName}
          isRenamingPossible={cluster.isAvailableForSettingsChanges()}
          isDeletionPossible={!cluster.task({group: ['deployment', 'network'], active: true})}
        />
        {networks.map((network) => {
          return (
            <Network
              key={network.id}
              network={network}
              cluster={cluster}
              validationError={(validationError || {}).networks}
              disabled={this.props.locked}
              verificationErrorField={_.pluck(_.where(verificationErrors, {network: network.id}), 'field')}
              currentNodeNetworkGroup={nodeNetworkGroup}
            />
          );
        })}
      </div>
    );
  }
});

var NetworkSubtabs = React.createClass({
  renderClickablePills(sections, isNetworkGroupPill) {
    var {cluster, nodeNetworkGroups, validationError} = this.props;
    var isNovaEnvironment = cluster.get('net_provider') == 'nova_network';

    var networkParametersErrors = (validationError || {}).networking_parameters;
    var networksErrors = (validationError || {}).networks;

    return (sections.map((groupName) => {
      var tabLabel = groupName;
      var isActive = groupName == this.props.activeGroupName;
      var isInvalid;

      // is one of predefined sections selected (networking_parameters)
      if (groupName == 'neutron_l2') {
        isInvalid = !!_.intersection(NetworkingL2Parameters.renderedParameters, _.keys(networkParametersErrors)).length;
      } else if (groupName == 'neutron_l3') {
        isInvalid = !!_.intersection(NetworkingL3Parameters.renderedParameters, _.keys(networkParametersErrors)).length;
      } else if (groupName == 'nova_configuration') {
        isInvalid = !!_.intersection(NovaParameters.renderedParameters, _.keys(networkParametersErrors)).length;
      } else if (groupName == 'network_settings') {
        var settings = cluster.get('settings');
        isInvalid = _.any(_.keys(settings.validationError), (settingPath) => {
          var settingSection = settingPath.split('.')[0];
          return settings.get(settingSection).metadata.group == 'network' ||
            settings.get(settingPath).group == 'network';
        });
      }

      if (isNetworkGroupPill) {
        isInvalid = networksErrors && (isNovaEnvironment || !!networksErrors[nodeNetworkGroups.findWhere({name: groupName}).id]);
      } else {
        tabLabel = i18n(networkTabNS + 'tabs.' + groupName);
      }

      if (groupName == 'network_verification') {
        tabLabel = i18n(networkTabNS + 'tabs.connectivity_check');
        isInvalid = this.props.showVerificationResult && cluster.task({
          name: 'verify_networks',
          status: 'error'
        });
      }

      return (
        <li
          key={groupName}
          role='presentation'
          className={utils.classNames({
            active: isActive,
            warning: this.props.isMultiRack && groupName == 'network_verification'
          })}
          onClick={_.partial(this.props.setActiveNetworkSectionName, groupName)}
        >
          <a className={'subtab-link-' + groupName}>
            {isInvalid && <i className='subtab-icon glyphicon-danger-sign' />}
            {tabLabel}
          </a>
        </li>
      );
    }));
  },
  render() {
    var {nodeNetworkGroups} = this.props;
    var settingsSections = [];
    var nodeGroupSections = nodeNetworkGroups.pluck('name');

    if (this.props.cluster.get('net_provider') == 'nova_network') {
      settingsSections.push('nova_configuration');
    } else {
      settingsSections = settingsSections.concat(['neutron_l2', 'neutron_l3']);
    }
    settingsSections.push('network_settings');

    return (
      <div className='col-xs-2'>
        <CSSTransitionGroup
          component='ul'
          transitionName='subtab-item'
          className='nav nav-pills nav-stacked node-network-groups-list'
          transitionEnter={false}
          transitionLeave={false}
          key='node-group-list'
          id='node-group-list'
        >
          <li className='group-title' key='group1'>
            {i18n(networkTabNS + 'tabs.node_network_groups')}
          </li>
          {this.renderClickablePills(nodeGroupSections, true)}
          <li className='group-title' key='group2'>
            {i18n(networkTabNS + 'tabs.settings')}
          </li>
          {this.renderClickablePills(settingsSections)}
          <li className='group-title' key='group3'>
            {i18n(networkTabNS + 'tabs.network_verification')}
          </li>
          {this.renderClickablePills(['network_verification'])}
        </CSSTransitionGroup>
      </div>
    );
  }
});

var NodeNetworkGroupTitle = React.createClass({
  mixins: [
    renamingMixin('node-group-title-input')
  ],
  onNodeNetworkGroupNameKeyDown(e) {
    this.setState({nodeNetworkGroupNameChangingError: null});
    if (e.key == 'Enter') {
      this.setState({actionInProgress: true});
      var element = this.refs['node-group-title-input'].getInputDOMNode();
      var newName = _.trim(element.value);
      var currentNodeNetworkGroup = this.props.currentNodeNetworkGroup;

      if (newName != currentNodeNetworkGroup.get('name')) {
        var validationError = currentNodeNetworkGroup.validate({name: newName});
        if (validationError) {
          this.setState({
            nodeNetworkGroupNameChangingError: validationError,
            actionInProgress: false
          });
          element.focus();
        } else {
          currentNodeNetworkGroup
            .save({name: newName}, {validate: false})
            .fail((response) => {
              this.setState({
                nodeNetworkGroupNameChangingError: utils.getResponseText(response)
              });
              element.focus();
            })
            .done(() => {
              this.endRenaming();
              this.props.setActiveNetworkSectionName(newName, true);
            });
        }
      } else {
        this.endRenaming();
      }
    } else if (e.key == 'Escape') {
      this.endRenaming();
      e.stopPropagation();
      ReactDOM.findDOMNode(this).focus();
    }
  },
  startNodeNetworkGroupRenaming(e) {
    this.setState({nodeNetworkGroupNameChangingError: null});
    this.startRenaming(e);
  },
  render() {
    var {currentNodeNetworkGroup, isRenamingPossible, isDeletionPossible} = this.props;
    var classes = {
      'network-group-name': true,
      'no-rename': !isRenamingPossible
    };
    return (
      <div className={utils.classNames(classes)} key={currentNodeNetworkGroup.id}>
        {this.state.isRenaming ?
          <Input
            type='text'
            ref='node-group-title-input'
            name='new-name'
            defaultValue={currentNodeNetworkGroup.get('name')}
            error={this.state.nodeNetworkGroupNameChangingError}
            disabled={this.state.actionInProgress}
            onKeyDown={this.onNodeNetworkGroupNameKeyDown}
            wrapperClassName='node-group-renaming clearfix'
            maxLength='50'
            selectOnFocus
            autoFocus
          />
        :
          <div className='name' onClick={isRenamingPossible && this.startNodeNetworkGroupRenaming}>
            <button className='btn-link'>{currentNodeNetworkGroup.get('name')}</button>
            {isRenamingPossible && <i className='glyphicon glyphicon-pencil' />}
          </div>
        }
        {isDeletionPossible && (
          currentNodeNetworkGroup.get('is_default') ?
            <span className='explanation'>{i18n(networkTabNS + 'default_node_network_group_info')}</span>
          :
            !this.state.isRenaming &&
              <i className='glyphicon glyphicon-remove' onClick={this.props.removeNodeNetworkGroup} />
        )}
      </div>
    );
  }
});

var Network = React.createClass({
  mixins: [
    NetworkInputsMixin,
    NetworkModelManipulationMixin
  ],
  autoUpdateParameters(cidr) {
    var useGateway = this.props.network.get('meta').use_gateway;
    if (useGateway) this.setValue('gateway', utils.getDefaultGatewayForCidr(cidr));
    this.setValue('ip_ranges', utils.getDefaultIPRangeForCidr(cidr, useGateway));
  },
  changeNetworkNotation(name, value) {
    var meta = _.clone(this.props.network.get('meta'));
    meta.notation = value ? 'cidr' : 'ip_ranges';
    this.setValue('meta', meta);
    if (value) this.autoUpdateParameters(this.props.network.get('cidr'));
  },
  render() {
    var meta = this.props.network.get('meta');
    if (!meta.configurable) return null;

    var networkName = this.props.network.get('name');

    var ipRangeProps = this.composeProps('ip_ranges', true);
    var gatewayProps = this.composeProps('gateway');
    return (
      <div className={'forms-box ' + networkName}>
        <h3 className='networks'>{i18n('network.' + networkName)}</h3>
        <div className='network-description'>{i18n('network.descriptions.' + networkName)}</div>
        <CidrControl
          {... this.composeProps('cidr')}
          changeNetworkNotation={this.changeNetworkNotation}
          autoUpdateParameters={this.autoUpdateParameters}
        />
        <Range
          {...ipRangeProps}
          disabled={ipRangeProps.disabled || meta.notation == 'cidr'}
          rowsClassName='ip-ranges-rows'
          verificationError={_.contains(this.props.verificationErrorField, 'ip_ranges')}
        />
        {meta.use_gateway &&
          <Input
            {...gatewayProps}
            type='text'
            disabled={gatewayProps.disabled || meta.notation == 'cidr'}
          />
        }
        <VlanTagInput
          {...this.composeProps('vlan_start')}
          label={i18n(networkTabNS + 'network.use_vlan_tagging')}
          value={this.props.network.get('vlan_start')}
        />
      </div>
    );
  }
});

var NovaParameters = React.createClass({
  mixins: [
    NetworkInputsMixin,
    NetworkModelManipulationMixin
  ],
  statics: {
    renderedParameters: [
      'floating_ranges', 'fixed_networks_cidr', 'fixed_network_size',
      'fixed_networks_amount', 'fixed_networks_vlan_start', 'dns_nameservers'
    ]
  },
  render() {
    var networkConfiguration = this.props.cluster.get('networkConfiguration');
    var networkingParameters = networkConfiguration.get('networking_parameters');
    var manager = networkingParameters.get('net_manager');
    var fixedNetworkSizeValues = _.map(_.range(3, 12), _.partial(Math.pow, 2));
    return (
      <div className='forms-box nova-config' key='nova-config'>
        <h3 className='networks'>{i18n(parametersNS + 'nova_configuration')}</h3>
        <Range
          {...this.composeProps('floating_ranges', true)}
          rowsClassName='floating-ranges-rows'
        />
        {this.renderInput('fixed_networks_cidr')}
        {(manager == 'VlanManager') ?
          <div>
            <Input
              {...this.composeProps('fixed_network_size', false, true)}
              type='select'
              children={_.map(fixedNetworkSizeValues, (value) => {
                return <option key={value} value={value}>{value}</option>;
              })}
              inputClassName='pull-left'
            />
            {this.renderInput('fixed_networks_amount', true)}
            <Range
              {...this.composeProps('fixed_networks_vlan_start', true)}
              wrapperClassName='clearfix vlan-id-range'
              label={i18n(parametersNS + 'fixed_vlan_range')}
              extendable={false}
              autoIncreaseWith={parseInt(networkingParameters.get('fixed_networks_amount'), 10) || 0}
              integerValue
              placeholder=''
              mini
            />
          </div>
        :
          <VlanTagInput
            {...this.composeProps('fixed_networks_vlan_start')}
            label={i18n(parametersNS + 'use_vlan_tagging_fixed')}
          />
        }
        <MultipleValuesInput {...this.composeProps('dns_nameservers', true)} />
      </div>
    );
  }
});

var NetworkingL2Parameters = React.createClass({
  mixins: [
    NetworkInputsMixin,
    NetworkModelManipulationMixin
  ],
  statics: {
    renderedParameters: [
      'vlan_range', 'gre_id_range', 'base_mac'
    ]
  },
  render() {
    var networkParameters = this.props.cluster.get('networkConfiguration').get('networking_parameters');
    var idRangePrefix = networkParameters.get('segmentation_type') == 'vlan' ? 'vlan' : 'gre_id';
    return (
      <div className='forms-box' key='neutron-l2'>
        <h3 className='networks'>{i18n(parametersNS + 'l2_configuration')}</h3>
        <div className='network-description'>{i18n(networkTabNS + 'networking_parameters.l2_' + networkParameters.get('segmentation_type') + '_description')}</div>
        <div>
          <Range
            {...this.composeProps(idRangePrefix + '_range', true)}
            extendable={false}
            placeholder=''
            integerValue
            mini
          />
          {this.renderInput('base_mac')}
        </div>
      </div>
    );
  }
});

var NetworkingL3Parameters = React.createClass({
  mixins: [
    NetworkInputsMixin,
    NetworkModelManipulationMixin
  ],
  statics: {
    renderedParameters: [
      'floating_ranges', 'internal_cidr', 'internal_gateway',
      'internal_name', 'floating_name', 'baremetal_range',
      'baremetal_gateway', 'dns_nameservers'
    ]
  },
  render() {
    var networks = this.props.cluster.get('networkConfiguration').get('networks');
    return (
      <div key='neutron-l3'>
        <div className='forms-box' key='floating-net'>
          <h3>
            <span className='subtab-group-floating-net'>{i18n(networkTabNS + 'floating_net')}</span>
          </h3>
          <div className='network-description'>{i18n('network.descriptions.floating')}</div>
          <Range
            {...this.composeProps('floating_ranges', true)}
            rowsClassName='floating-ranges-rows'
            hiddenControls
          />
          {this.renderInput('floating_name', false, {maxLength: '65'})}
        </div>
        <div className='forms-box' key='internal-net'>
          <h3>
            <span className='subtab-group-internal-net'>{i18n(networkTabNS + 'internal_net')}</span>
          </h3>
          <div className='network-description'>{i18n('network.descriptions.internal')}</div>
          {this.renderInput('internal_cidr')}
          {this.renderInput('internal_gateway')}
          {this.renderInput('internal_name', false, {maxLength: '65'})}
        </div>
        {networks.findWhere({name: 'baremetal'}) &&
          <div className='forms-box' key='baremetal-net'>
            <h3>
              <span className='subtab-group-baremetal-net'>{i18n(networkTabNS + 'baremetal_net')}</span>
            </h3>
            <div className='network-description'>{i18n(networkTabNS + 'networking_parameters.baremetal_parameters_description')}</div>
            <Range
              key='baremetal_range'
              {...this.composeProps('baremetal_range', true)}
              extendable={false}
              hiddenControls
            />
            {this.renderInput('baremetal_gateway')}
          </div>
        }
        <div className='forms-box' key='dns-nameservers'>
          <h3>
            <span className='subtab-group-dns-nameservers'>{i18n(networkTabNS + 'dns_nameservers')}</span>
          </h3>
          <div className='network-description'>{i18n(networkTabNS + 'networking_parameters.dns_servers_description')}</div>
          <MultipleValuesInput {...this.composeProps('dns_nameservers', true)} />
        </div>
      </div>
    );
  }
});

var NetworkSettings = React.createClass({
  onChange(groupName, settingName, value) {
    var settings = this.props.cluster.get('settings');
    var name = settings.makePath(groupName, settingName, settings.getValueAttribute(settingName));
    this.props.settingsForChecks.set(name, value);
    // FIXME: the following hacks cause we can't pass {validate: true} option to set method
    // this form of validation isn't supported in Backbone DeepModel
    settings.validationError = null;
    settings.set(name, value);
    settings.isValid({models: this.props.configModels});
  },
  checkRestrictions(action, setting) {
    return this.props.cluster.get('settings').checkRestrictions(this.props.configModels, action, setting);
  },
  render() {
    var cluster = this.props.cluster;
    var settings = cluster.get('settings');
    var locked = this.props.locked || !!cluster.task({group: ['deployment', 'network'], active: true});
    var lockedCluster = !cluster.isAvailableForSettingsChanges();
    var allocatedRoles = _.uniq(_.flatten(_.union(cluster.get('nodes').pluck('roles'), cluster.get('nodes').pluck('pending_roles'))));
    return (
      <div className='forms-box network'>
        {
          _.chain(settings.attributes)
            .keys()
            .filter(
              (sectionName) => {
                var section = settings.get(sectionName);
                return (section.metadata.group == 'network' || _.any(section, {group: 'network'})) &&
                  !this.checkRestrictions('hide', section.metadata).result;
              }
            )
            .sortBy(
              (sectionName) => settings.get(sectionName + '.metadata.weight')
            )
            .map(
              (sectionName) => {
                var section = settings.get(sectionName);
                var settingsToDisplay = _.compact(_.map(section, (setting, settingName) => {
                  if (
                    (section.metadata.group || setting.group == 'network') &&
                    settingName != 'metadata' &&
                    setting.type != 'hidden' &&
                    !this.checkRestrictions('hide', setting).result
                  ) return settingName;
                }));
                if (_.isEmpty(settingsToDisplay) && !settings.isPlugin(section)) return null;
                return <SettingSection
                  {... _.pick(this.props, 'cluster', 'initialAttributes', 'settingsForChecks', 'configModels')}
                  key={sectionName}
                  sectionName={sectionName}
                  settingsToDisplay={settingsToDisplay}
                  onChange={_.bind(this.onChange, this, sectionName)}
                  allocatedRoles={allocatedRoles}
                  settings={settings}
                  makePath={settings.makePath}
                  getValueAttribute={settings.getValueAttribute}
                  locked={locked}
                  lockedCluster={lockedCluster}
                  checkRestrictions={this.checkRestrictions}
                />;
              }
            )
            .value()
        }
      </div>
    );
  }
});

var NetworkVerificationResult = React.createClass({
  getConnectionStatus(task, isFirstConnectionLine) {
    if (!task || task.match({status: 'ready'})) return 'stop';
    if (task && task.match({status: 'error'}) && !(isFirstConnectionLine &&
      !task.get('result').length)) return 'error';
    return 'success';
  },
  render() {
    var task = this.props.task;
    var ns = networkTabNS + 'verify_networks.';

    if (this.props.hideVerificationResult) task = null;
    return (
      <div className='verification-control'>
        <div className='forms-box'>
          <h3>{i18n(networkTabNS + 'tabs.connectivity_check')}</h3>
          {this.props.isMultirack &&
            <div className='alert alert-warning'>
              <p>{i18n(networkTabNS + 'verification_multirack_warning')}</p>
            </div>
          }
          {!this.props.isMultirack && this.props.notEnoughNodes &&
            <div className='alert alert-warning'>
              <p>{i18n(networkTabNS + 'not_enough_nodes')}</p>
            </div>
          }
          <div className='page-control-box'>
            <div className='verification-box row'>
              <div className='verification-network-placeholder col-xs-10 col-xs-offset-2'>
                <div className='router-box'>
                  <div className='verification-router'></div>
                </div>
                <div className='animation-box'>
                  {_.times(3, (index) => {
                    ++index;
                    return <div key={index} className={this.getConnectionStatus(task, index == 1) + ' connect-' + index}></div>;
                  })}
                </div>
                <div className='nodes-box'>
                  {_.times(3, (index) => {
                    ++index;
                    return <div key={index} className={'verification-node-' + index}></div>;
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className='row'>
            <div className='verification-text-placeholder col-xs-12'>
              <ol className='verification-description'>
                {_.times(5, (index) => {
                  return <li key={index}>{i18n(ns + 'step_' + index)}</li>;
                })}
              </ol>
            </div>
          </div>
          <button
            key='verify_networks'
            className='btn btn-default verify-networks-btn'
            onClick={this.props.verifyNetworks}
            disabled={this.props.isVerificationDisabled}
          >
            {i18n(networkTabNS + 'verify_networks_button')}
          </button>
        </div>
        {(task && task.match({status: 'ready'})) &&
          <div className='col-xs-12'>
            <div className='alert alert-success enable-selection'>
              {i18n(ns + 'success_alert')}
            </div>
            {task.get('message') &&
              <div className='alert alert-warning enable-selection'>
                {task.get('message')}
              </div>
            }
          </div>
        }
        {task && task.match({status: 'error'}) &&
          <div className='col-xs-12'>
            <div className='alert alert-danger enable-selection network-alert'>
              {i18n(ns + 'fail_alert')}
              {utils.renderMultilineText(task.get('message'))}
            </div>
          </div>
        }
        {(task && !!task.get('result').length) &&
          <div className='verification-result-table col-xs-12'>
            <Table
              tableClassName='table table-condensed enable-selection'
              noStripes
              head={_.map(['node_name', 'node_mac_address', 'node_interface', 'expected_vlan'],
                (attr) => ({label: i18n(ns + attr)}))}
              body={
                _.map(task.get('result'), (node) => {
                  var absentVlans = _.map(node.absent_vlans, (vlan) => {
                    return vlan || i18n(networkTabNS + 'untagged');
                  });
                  return [node.name || 'N/A', node.mac || 'N/A', node.interface, absentVlans.join(', ')];
                })
              }
            />
          </div>
        }
      </div>
    );
  }
});

export default NetworkTab;
