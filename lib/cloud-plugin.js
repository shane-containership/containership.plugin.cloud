'use strict';

const constants = require('./constants');
const Firewall = require('./firewall');
const Registries = require('./registries');
const SSH_Keys = require('./ssh_keys');
const utils = require('./utils');

const { ContainershipPlugin, ApiBuilder } = require('@containership/containership.plugin');
const _ = require('lodash');
const async = require('async');
const request = require('request');
const tarfs = require('tar-fs');

class ContainershipCloudPlugin extends ContainershipPlugin {

    constructor() {
        super({
            name: 'cloud',
            description: 'A plugin to interface with Containership Cloud.',
            types: ['core']
        });

        this.cloudCache = {};
    }

    initializeRoutes(org, cluster) {
        this.routes = {
            cluster: {
                register: `/v2/organizations/${org}/clusters/${cluster}`,
                instances: `/v2/organizations/${org}/clusters/${cluster}/instances`,
                ips: `/v2/organizations/${org}/clusters/${cluster}/instances/ips`,
                details: `/v2/organizations/${org}/clusters/${cluster}`,
                firewalls: `/v2/organizations/${org}/clusters/${cluster}/firewalls`,
                loadbalancers: `/v2/organizations/${org}/clusters/${cluster}/loadbalancers`,
                registries: `/v2/organizations/${org}/registries`,
                ssh_keys: `/v2/organizations/${org}/clusters/${cluster}/ssh_keys`
            }
        }
    }

    apiRequest(verb, endpoint, data, cb) {
        const { api_key, organization } = this.config.core;
        const clusterId = this.host.getClusterId();

        if(api_key && organization) {
            const options = {
                baseUrl: constants.environment.CLOUD_API_BASE_URL,
                url: endpoint,
                method: verb,
                timeout: 15000,
                headers: {
                    Authorization: `Bearer ${api_key}`
                },
                body: data,
                json: true
            };

            const logError = (err) => {
                console.error(`ERROR in cloud plugin: ${verb} -- ${constants.environment.CLOUD_API_BASE_URL}${endpoint} -> `, err);
            };

            request(options, (err, response) => {
                if(err) {
                    logError(err);
                } else if(response.statusCode !== 200 && response.statusCode !== 201) {
                    logError(new Error(response.body));
                } else if(cb) {
                    return cb(response.body);
                }
            });

        } else {
            if(cb) {
                return cb(new Error(`Required paramaters not available fetching ${endpoint}`));
            } }
    }

    apiPost(route, body, cb) {
        this.apiRequest('POST', route, body, cb);
    }

    apiGet(route, cb) {
        this.apiRequest('GET', route, {}, cb);
    }

    registerCluster(cb) {
        return async.waterfall([
            (cb) => {
                if (this.pubic_api_ip) {
                    return cb(null, this.public_api_ip);
                }

                return this.host.getApi().getHosts((err, hosts) => {
                    if (err) {
                        return cb(err);
                    }

                    const leader = _.find(hosts, (host) => {
                        return host.mode === 'leader';
                    });

                    if (!leader) {
                        return cb('Could not find leader host');
                    }

                    this.public_api_ip = leader.address.public;
                    return cb(null, leader.address.public);
                });
            },
            (api_ip, cb) => {
                const body = {
                    ipaddress: api_ip,
                    port: this.host.getApiPort(),
                    api_version: this.host.getApiVersion()
                };

                return this.apiPost(_.get(this.routes, ['cluster', 'register']), body, cb);
            }
        ], (err, res) => {
            if (err) {
                return cb && cb(err);
            }

            return cb && cb();
        });
    }


    fetchCluster(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'instances']), cb);
    }

    fetchClusterIps(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'ips']), cb);
    }

    fetchClusterDetails(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'details']), cb);
    }

    fetchFirewalls(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'firewalls']), cb);
    }

    fetchLoadBalancers(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'loadbalancers']), cb);
    }

    fetchRegistries(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'registries']), cb);
    }

    fetchSSHKeys(cb) {
        this.apiGet(_.get(this.routes, ['cluster', 'ssh_keys']), cb);
    }

    isCached(k, v) {
        return _.isEqual(this.cloudCache[k], v);
    }

    setDistributedValueAndCache(k, v) {
        this.host.getApi().setDistributedKey(k, v, (err) => {
            if(!err) {
                this.cloudCache[k] = v;
            }
        });
    }

    setDistributedValueIfNeeded(k, v) {
        if(!this.isCached(k, v)) {
            this.setDistributedValueAndCache(k,v);
        }
    }

    syncClusterDetails() {
        this.fetchClusterDetails((resp) => {
            const clusterDetails = _.pick(resp, 'environment');
            const snapshottingConfiguration = _.pick(resp, 'snapshotting_configuration');
            const autoTerminationConfiguration = _.pick(resp, 'auto_termination_configuration');

            this.setDistributedValueIfNeeded(constants.myriad.CLUSTER_DETAILS, clusterDetails);
            this.setDistributedValueIfNeeded(constants.myriad.SNAPSHOTTING_CONFIGURATION, snapshottingConfiguration);
            this.setDistributedValueIfNeeded(constants.myriad.AUTO_TERMINATION_CONFIGURATION, autoTerminationConfiguration);

        });
    }

    syncFirewalls() {
        this.fetchFirewalls((resp) => {
            this.setDistributedValueIfNeeded(constants.myriad.FIREWALLS, resp);
        });
    }

    syncLoadBalancers() {
        this.fetchLoadBalancers((resp) => {
            this.setDistributedValueIfNeeded(constants.myriad.LOADBALANCERS, resp);
        });
    }

    syncRegistries() {
        this.fetchRegistries((resp) => {
            this.setDistributedValueIfNeeded(constants.myriad.REGISTRIES, resp);
        });
    }

    syncSSHKeys() {
        this.fetchSSHKeys((resp) => {
            this.setDistributedValueIfNeeded(constants.myriad.SSH_KEYS, resp);
        });
    }

    start(host) {
        this.host = host;

        super.start(host);

        const { organization } = this.config.core;
        const clusterId = this.host.getClusterId();

        this.initializeRoutes(organization, clusterId);

        // explicitly disable firewalls for now
        // const firewall = new Firewall(host);
        // firewall.enable();

        // enable SSH key management
        new SSH_Keys(host);

        this.fetchClusterIps((cidr) => {
            this.host.getApi().discoverPeers(cidr);
        });
    }

    startLeader(host) {
        super.startLeader(host);

        try {
            setInterval(() => {
                this.registerCluster();
                this.syncClusterDetails();
                this.syncFirewalls();
                this.syncLoadBalancers();
                this.syncRegistries();
                this.syncSSHKeys();
            }, ContainershipCloudPlugin.SYNC_INTERVAL);
        } catch(err) {
            console.error('Failed with err: ' + err);
        }
    }

    startFollower(host) {
        const { organization } = this.config.core;
        const cluster_id = this.host.getClusterId();

        super.startFollower(host);

        // write registry auth
        new Registries(this.config, host);

        // set cloud specific environment variables
        host.getApi().addPreDeployMiddleware((app_desc, callback) => {
            const app_name = app_desc.id;
            const sanitized_app_name = app_name.replace(/-/g, '_');

            const dns_hash = utils.md5(`${organization}.${cluster_id}`);
            const dns_entry = `${app_name}.${dns_hash}.dns.cship.co`;

            app_desc.env_vars[`CS_CLOUD_DNS_ADDRESS_${sanitized_app_name.toUpperCase()}`] = dns_entry;
            app_desc.env_vars.CS_CLOUD_ORGANIZATION_ID = config.organization;

            host.getApi().getDistributedKey(constants.myriad.CLUSTER_DETAILS, (err, cluster_details) => {
                if(err) {
                    console.error('Error reading cluster details from distributed state');
                } else if(cluster_details.environment) {
                    app_desc.env_vars.CS_CLOUD_ENV = cluster_details.environment;
                    app_desc.env_vars.CS_CLOUD_ENVIRONMENT = cluster_details.environment;
                    app_desc.env_vars.CSC_ENV = cluster_details.environment;
                    app_desc.env_vars.CSC_ENVIRONMENT = cluster_details.environment;
                }

                return callback(null, app_desc);
            });
        });
    }

    backupRequestLeader(host, req, res) {
        const orchestrator = host.getOrchestrator();

        if(orchestrator === 'kubernetes') {
            if(req.query.CSC_PERSIST_DATA === 'true') {
                console.warn('Kubernetes does not support persistent data snapshots, taking snapshot without data...');
            }

            return backupKubernetesCluster(host, req, res);
        } else if(orchestrator === 'containership') {
            return backupContainershipCluster(host, req, res);
        } else {
            return res.status(500).json({
                error: `Orchestrator: ${orchestrator} does not support backup requests`
            });
        }
    }

    getApiRoutes(host) {
        super.getApiRoutes(host);

        const api = host.getApi();

        return new ApiBuilder()
            .post('/cluster/backup', (req, res) => {
                if(host.isLeader()) {
                    this.backupRequestLeader(host, req, res);
                } else {
                    return console.warn('Follower host does not support receiving a backup cluster request');
                }
            })
        .value();
    }
}

function backupKubernetesCluster(host, req, res) {
    const api = host.getApi();

    return api.getApplications((err, apps) => {
        if(err) {
            return console.error(err);
        }

        return res.json(apps);
    });
}

function backupContainershipCluster(host, req, res) {
    // todo: support Containership backups
    return res.sendStatus(501);
}

ContainershipCloudPlugin.SYNC_INTERVAL = 15000;

module.exports = ContainershipCloudPlugin;
