'use strict';

const configuration = require('./configuration');
const constants = require('./constants');
const logger = require('./logger');
const Table = require('./table');

const _ = require('lodash');
const chalk = require('chalk');
const flatten = require('flat');
const unflatten = flatten.unflatten;
const prmpt = require('prompt');
const request = require('request');

module.exports = {
    name: 'cloud',
    description: 'Containership cloud management client.',
    commands: []
};

module.exports.commands.push({
    name: 'account',
    description: 'Show and manipulate cloud account.',
    commands: [
        {
            name: 'login',
            description: 'Login command for cloud services.',
            callback: () => {
                prmpt.message = '';
                prmpt.delimiter = chalk.white(':');
                prmpt.start();

                prmpt.get([{
                    name: 'token',
                    description: chalk.white('Containership Cloud Personal Access Token'),
                    required: true
                }], (err, auth) => {
                    if(err) {
                        return logger.error('Invalid Containership Cloud personal access token!');
                    }

                    const request_options = {
                        url: `${constants.environment.AUTH_API_BASE_URL}/v1/verify`,
                        method: 'GET',
                        json: true,
                        headers: {
                            Authorization: `Bearer ${auth.token}`
                        },
                        timeout: 5000
                    };

                    return request(request_options, (err, response) => {
                        if(err || response.statusCode !== 204) {
                            return logger.error('Failed to log in to Containership Cloud!');
                        }

                        const conf = configuration.get();
                        conf.metadata = conf.metadata || {};
                        conf.metadata.request = conf.metadata.request || {};
                        conf.metadata.request.headers = conf.metadata.request.headers || {};
                        conf.metadata.request.headers.authorization = `Bearer ${auth.token}`;
                        configuration.set(conf);

                        return logger.info('Successfully logged in to Containership Cloud!');
                    });
                });
            }
        },
        {
            name: 'logout',
            description: 'Logout of the cloud service.',
            callback: () => {
                // clear cloud token
                const conf = configuration.get();
                delete conf.metadata.request.headers.authorization;
                configuration.set(conf);

                return logger.info('Successfully logged out!');
            }
        },
        {
            name: 'info',
            description: 'Show information about logged in cloud account.',
            callback: () => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');

                if(!authorization) {
                    return logger.error('You must be logged in to view account info!');
                }

                let request_options = {
                    url: `${constants.environment.CLOUD_API_BASE_URL}/v2/account`,
                    method: 'GET',
                    json: true,
                    headers: {
                        'authorization': authorization
                    }
                };

                return request(request_options, function(err, response) {
                    if(err || response.statusCode !== 200) {
                        return logger.error('Could not fetch account info!');
                    }

                    const headers = [
                        'ID',
                        'EMAIL',
                        'ORGANIZATIONS',
                        'SIGNUP_METHOD',
                        'NAME',
                        'PHONE',
                        'METADATA'
                    ];

                    const account = response.body;

                    const data = [
                        account.id,
                        account.email,
                        account.organizations.map(org => {
                            return `${chalk.gray(org.name)}: ${org.id}`;
                        }).join('\n'),
                        account.signup_method,
                        account.name,
                        account.phone,
                        _.map(flatten(account.metadata || {}), (v, k) => {
                            return `${chalk.gray(k)}: ${v}`;
                        }).join('\n')
                    ];

                    const output = Table.createVerticalTable(headers, [data]);
                    return logger.info(output);
                });
            }
        },
        {
            name: 'edit',
            description: 'Edit account information for user in Containership cloud.',
            options: {
                phone: {
                    description: 'Phone number for user account.',
                    type: 'string',
                    alias: 'p'
                },
                name: {
                    description: 'Name number for user account.',
                    type: 'string',
                    alias: 'n'
                },
                email: {
                    description: 'Email for user account.',
                    type: 'string',
                    alias: 'e'
                },
                metadata: {
                    description: 'Metadata keys to be updated on the user account',
                    type: 'string',
                    array: true,
                    alias: 'm',
                    default: []
                }
            },
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');

                if(!authorization) {
                    return logger.error('You must be logged in to edit account info!');
                }

                if(!argv.name && !argv.phone && !argv.email && !argv.metadata.length) {
                    return logger.error('You must provide either name, email, phone, or metadata as a flag to edit');
                }

                let options = _.omit(argv, ['h', 'help', '$0', '_']);

                options.metadata = _.reduce(options.metadata, (acc, value) => {
                    value = value.split('=');
                    acc[value[0]] = value.length >= 2 ? _.slice(value, 1).join('=') : null;
                    return acc;
                }, {});

                options.metadata = unflatten(options.metadata);

                let request_options = {
                    url: `${constants.environment.CLOUD_API_BASE_URL}/v2/account`,
                    method: 'PUT',
                    json: true,
                    body: options,
                    headers: {
                        'authorization': authorization
                    }
                };

                return request(request_options, function(err, response) {
                    if(err) {
                        return logger.error('There was an error updating account info!');
                    }

                    if(response.statusCode !== 200) {
                        return logger.error('There was an error updating account info!');
                    }

                    return logger.info('Successfully updated account info!');
                });
            }
        }
    ]
});

function getOrganization(id, authorization, callback) {
    if(!authorization) {
        return callback('You must be logged in to list organizations!');
    }

    const request_options = {
        url: `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${id}`,
        method: 'GET',
        json: true,
        headers: {
            'authorization': authorization
        }
    };

    return request(request_options, function(err, response) {
        if(err || response.statusCode !== 200) {
            return callback('You do not have permissions to use this organization!');
        }

        return callback(null, response.body);
    });
}

module.exports.commands.push({
    name: 'org',
    description: 'Cloud organization commands.',
    commands: [
        {
            name: 'list',
            description: 'List available organizations.',
            callback: () => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');

                if(!authorization) {
                    return logger.error('You must be logged in to list organizations!');
                }

                const request_options = {
                    url: `${constants.environment.CLOUD_API_BASE_URL}/v2/account`,
                    method: 'GET',
                    json: true,
                    headers: {
                        'authorization': authorization
                    }
                };

                return request(request_options, function(err, response) {
                    if(err || response.statusCode !== 200) {
                        return logger.error('Could not fetch organizations!');
                    }

                    const headers = ['ID', 'ORGANIZATION'];
                    const data = response.body.organizations.map(org => [org.id, org.name]);
                    const output = Table.createTable(headers, data);

                    return logger.info(output);
                });
            }
        },
        {
            name: 'edit <org_id>',
            description: 'Edit Containership cloud organization',
            options: {
                name: {
                    description: 'Name of the organization.',
                    alias: 'n',
                    type: 'string'
                }
            },
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');

                if(!authorization) {
                    return logger.error('You must be logged in to edit a organization!');
                }

                let options = _.omit(argv, ['h', 'help', '$0', '_']);

                if(options.name === undefined) {
                    return logger.error('You must specify a flag for what is being edited on the organization. See command help for more details.');
                }

                options.organization_name = options.name;
                delete options.name;

                const request_options = {
                    url: `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${argv.org_id}`,
                    method: 'PUT',
                    json: true,
                    body: options,
                    headers: {
                        'authorization': authorization
                    }
                };

                return request(request_options, function(err, response) {
                    if(err) {
                        return logger.error('There was an error updating the organization!');
                    }

                    if(response.statusCode === 404) {
                        return logger.error('The organization id specified does not exist!');
                    }

                    if(response.statusCode !== 200) {
                        return logger.error('There was an error updating the organization!');
                    }

                    return logger.info('Successfully updated the organization!');
                });
            }
        },
        {
            name: 'use <org_id>',
            description: 'Set organization as active org.',
            callback: (args) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');

                if(!authorization) {
                    return logger.error('You must be logged in to list organizations!');
                }

                return getOrganization(args.org_id, authorization, (err, org) => {
                    if(err) {
                        return logger.error(err);
                    }

                    const owner = _.find(org.users, { id: org.owner });

                    const headers = [
                        'ID',
                        'ORGANIZATION',
                        'OWNER',
                        'TIER'
                    ];

                    const data = [
                        org.id,
                        org.name,
                        owner.display_name,
                        org.billing.tier
                    ];

                    conf.metadata.cloud = conf.metadata.cloud || {};
                    conf.metadata.cloud.active_organization = org.id;
                    configuration.set(conf);

                    const output = Table.createVerticalTable(headers, [data]);

                    logger.info(output);
                    return logger.info(`Successfully switched to ${org.id} organization!`);
                });
            }
        },
        {
            name: 'show <org_id>',
            description: 'Show organization details.',
            callback: (args) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');

                if(!authorization) {
                    return logger.error('You must be logged in to list organizations!');
                }

                return getOrganization(args.org_id, authorization, (err, org) => {
                    if(err) {
                        return logger.error(err);
                    }

                    const owner = _.find(org.users, { id: org.owner });

                    const headers = [
                        'ID',
                        'ORGANIZATION',
                        'OWNER',
                        'TIER',
                        'CREATED_AT',
                        'TEAMS'
                    ];

                    const teams = org.teams.map((team) => {
                        return `${chalk.gray(team.name)}: ${team.description}`;
                    });

                    const data = [
                        org.id,
                        org.name,
                        owner.display_name,
                        org.billing.tier,
                        org.created_at,
                        teams.join('\n')
                    ];

                    const output = Table.createVerticalTable(headers, [data]);

                    return logger.info(output);
                });
            }
        }
    ]
});

function getCluster(org_id, cluster_id, authorization, callback) {
    if(!authorization) {
        return callback('You must be logged in to list clusters!');
    }

    let request_options = {
        url: `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${org_id}/clusters/${cluster_id}`,
        method: 'GET',
        json: true,
        headers: {
            'authorization': authorization
        }
    };

    return request(request_options, function(err, response) {
        if(err || response.statusCode !== 200) {
            return callback('You do not have permissions to use this cluster!');
        }

        return callback(null, response.body);
    });
}

module.exports.commands.push({
    name: 'cluster',
    description: 'Cloud cluster commands.',
    commands: [
        {
            name: 'list',
            description: 'List available clusters for active org.',
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');
                const org_id = _.get(conf, 'metadata.cloud.active_organization');

                if(!authorization) {
                    return logger.error('You must be logged in to list organizations!');
                }

                if(!org_id) {
                    return logger.error(`You must have an active_organization to edit a cluster. See '${argv.$0} cloud organization use <org_id>'.`);
                }

                const request_options = {
                    url: `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${org_id}/clusters`,
                    method: 'GET',
                    json: true,
                    headers: {
                        'authorization': authorization
                    }
                };

                return request(request_options, function(err, response) {
                    if(err || response.statusCode !== 200) {
                        return logger.error('Could not fetch organizations!');
                    }

                    const headers = [
                        'ID',
                        'NAME',
                        'ENVIRONMENT',
                        'CLOUD_PROVIDER',
                        'HOST_COUNT',
                        'APP_COUNT'
                    ];

                    const data = response.body.map(cluster => {
                        return [
                            cluster.id,
                            cluster.name || '',
                            cluster.environment || '',
                            cluster.provider_name || '',
                            _.keys(cluster.hosts).length,
                            _.keys(cluster.applications).length
                        ];
                    });

                    const output = Table.createTable(headers, data);

                    return logger.info(output);
                });
            }
        },
        {
            name: 'edit <cluster_id>',
            description: 'Edit Containership cloud cluster',
            options: {
                locked: {
                    description: 'Whether or not the cluster is locked from modifications.',
                    alias: 'l',
                    type: 'boolean',
                    default: undefined
                }
            },
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');
                const org_id = _.get(conf, 'metadata.cloud.active_organization');

                if(!authorization) {
                    return logger.error('You must be logged in to edit a cluster!');
                }

                if(!org_id) {
                    return logger.error(`You must have an active_organization to edit a cluster. See '${argv.$0} cloud organization use <org_id>'.`);
                }

                let options = _.omit(argv, ['h', 'help', '$0', '_']);

                if(options.locked === undefined) {
                    return logger.error('You must specify a flag for what is being edited on the cluster. See command help for more details.');
                }

                const request_options = {
                    url: `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${org_id}/clusters/${argv.cluster_id}`,
                    method: 'PUT',
                    json: true,
                    body: options,
                    headers: {
                        'authorization': authorization
                    }
                };

                return request(request_options, function(err, response) {
                    if(err) {
                        return logger.error('There was an error updating the cluster!');
                    }

                    if(response.statusCode === 404) {
                        return logger.error('The cluster id specified does not exist!');
                    }

                    if(response.statusCode !== 200) {
                        return logger.error('There was an error updating the cluster!');
                    }

                    return logger.info('Successfully updated the cluster!');
                });
            }
        },
        {
            name: 'delete <cluster_id>',
            description: 'Delete Containership cloud cluster.',
            options: {
                force: {
                    description: 'Force cluster deletion without prompt.',
                    alias: 'f',
                    type: 'boolean',
                    default: false
                }
            },
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');
                const org_id = _.get(conf, 'metadata.cloud.active_organization');
                prmpt.message = '';
                prmpt.delimiter = chalk.red(':');
                prmpt.start();
                const prmpt_regex = new RegExp('^y$|^yes$|^n$|^no$', 'i');
                const confirmation_regex = new RegExp('^y$|^yes$', 'i');

                prmpt.get({
                    name: 'value',
                    message: chalk.red(`Are you sure you want to delete cluster: ${argv.cluster_id}? THIS OPERATION CANNOT BE REVERSED!`),
                    validator: prmpt_regex,
                    warning: 'Must respond yes or no',
                    default: 'no',
                    ask: () => {
                        // only prompt for confirmation if '-f', or '--force' flag not passed in CLI
                        return !argv.force;
                    }
                }, (err, confirmation) => {
                    if(err) {
                        return logger.error(err.message || 'There was an error parsing your response!');
                    }
                    if(argv.force || confirmation_regex.test(confirmation.value)) {
                        return executeDelete(org_id, argv);
                    }
                    return logger.error('Delete cluster command aborted!');
                });

                function executeDelete(org_id, argv) {
                    if(!authorization) {
                        return logger.error('You must be logged in to edit a cluster!');
                    }

                    if(!org_id) {
                        return logger.error(`You must have an active_organization to edit a cluster. See '${argv.$0} cloud organization use <org_id>'.`);
                    }

                    const request_options = {
                        url: `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${org_id}/clusters/${argv.cluster_id}`,
                        method: 'DELETE',
                        json: true,
                        headers: {
                            'authorization': authorization
                        }
                    };

                    return request(request_options, (err, response) => {
                        if(err) {
                            return logger.error('There was an error deleting the cluster!');
                        }

                        if(response.statusCode === 404) {
                            return logger.error('The cluster id specified does not exist!');
                        }

                        if(response.statusCode !== 200) {
                            return logger.error('There was an error deleting the cluster!');
                        }

                        return logger.info('Successfully deleted the cluster!');
                    });
                }
            }
        },
        {
            name: 'use <cluster_id>',
            description: 'Use cluster as active cluster.',
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');
                const org_id = _.get(conf, 'metadata.cloud.active_organization');

                if(!authorization) {
                    return logger.error('You must be logged in to use a cluster!');
                }

                if(!org_id) {
                    return logger.error(`You must have an active_organization to edit a cluster. See '${argv.$0} cloud organization use <org_id>'.`);
                }

                return getCluster(org_id, argv.cluster_id, authorization, (err, cluster) => {
                    if(err) {
                        return logger.error(err);
                    }

                    conf.remotes = conf.remotes || {};
                    conf.remotes[cluster.id] = {
                        'url': `${constants.environment.CLOUD_API_BASE_URL}/v2/organizations/${org_id}/clusters/${cluster.id}/proxy`,
                        'version': cluster.api_version
                    };
                    conf.metadata.active_remote = cluster.id;
                    configuration.set(conf);

                    const headers = [
                        'ID',
                        'NAME',
                        'ENVIRONMENT',
                        'CLOUD_PROVIDER',
                        'HOST_COUNT',
                        'APP_COUNT'
                    ];

                    const data = [
                        cluster.id,
                        cluster.name || '',
                        cluster.environment || '',
                        cluster.provider_name || '',
                        _.keys(cluster.hosts).length,
                        _.keys(cluster.applications).length
                    ];

                    const output = Table.createVerticalTable(headers, [data]);

                    logger.info(output);
                    return logger.info(`Successfully switched to use cluster: ${cluster.id}`);
                });
            }
        },
        {
            name: 'show <cluster_id>',
            description: 'Show cluster details.',
            callback: (argv) => {
                const conf = configuration.get();
                const authorization = _.get(conf, 'metadata.request.headers.authorization');
                const org_id = _.get(conf, 'metadata.cloud.active_organization');

                if(!authorization) {
                    return logger.error('You must be logged in to list organizations!');
                }

                if(!org_id) {
                    return logger.error(`You must have an active_organization to edit a cluster. See '${argv.$0} cloud organization use <org_id>'.`);
                }

                return getCluster(org_id, argv.cluster_id, authorization, (err, cluster) => {
                    if(err) {
                        return logger.error(err);
                    }

                    const headers = [
                        'ID',
                        'NAME',
                        'ENVIRONMENT',
                        'CREATED_AT',
                        'CLOUD_PROVIDER',
                        'PUBLIC_IP',
                        'PORT',
                        'LOCKED',
                        'LEADER_COUNT',
                        'FOLLOWER_COUNT',
                        'APP_COUNT',
                        'TOTAL CPUS',
                        'TOTAL MEMORY'
                    ];

                    const cpus = _.reduce(cluster.hosts, (acc, host) => {
                        if(host.mode !== 'follower') {
                            return acc;
                        }

                        return acc + parseFloat(host.cpus);
                    }, 0);

                    const memory = _.reduce(cluster.hosts, (acc, host) => {
                        if(host.mode !== 'follower') {
                            return acc;
                        }

                        return acc + parseInt(host.memory);
                    }, 0);

                    const data = [
                        cluster.id,
                        cluster.name,
                        cluster.environment,
                        cluster.created_at,
                        cluster.provider_name,
                        cluster.ipaddress,
                        cluster.port,
                        cluster.locked,
                        _.filter(cluster.hosts, { mode: 'follower' }).length,
                        _.filter(cluster.hosts, { mode: 'leader' }).length,
                        _.keys(cluster.applications).length,
                        cpus.toFixed(2),
                        `${parseInt(memory / (1024*1024))} MB`
                    ];

                    const output = Table.createVerticalTable(headers, [data]);

                    return logger.info(output);
                });
            }
        }
    ]
});
