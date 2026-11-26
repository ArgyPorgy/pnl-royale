/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/royale.json`.
 */
export type Royale = {
  "address": "7bs2GJKVpupZgmwGWteQhnSup3e1wuNtQ4yqfd6Xx89T",
  "metadata": {
    "name": "royale",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "PnL Royale: battle royale for traders on MagicBlock Private Ephemeral Rollups"
  },
  "instructions": [
    {
      "name": "abortRound",
      "discriminator": [
        15,
        165,
        47,
        198,
        108,
        207,
        150,
        208
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "beginRound",
      "discriminator": [
        209,
        88,
        27,
        188,
        15,
        243,
        202,
        186
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "oracleQueue"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "callbackStorm",
      "discriminator": [
        175,
        216,
        227,
        165,
        226,
        21,
        85,
        232
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity: its signature proves the VRF program issued this callback for us."
          ],
          "signer": true,
          "address": "AqRbqZK8qZYFm5VmwYhgDQnicyiHYYNPMdFxRqAwZnL3"
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "interval",
          "type": "u8"
        }
      ]
    },
    {
      "name": "closePosition",
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "room",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeRoom",
      "discriminator": [
        152,
        197,
        88,
        192,
        98,
        197,
        51,
        211
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "docs": [
            "Back on Solana: a delegated room is owned by the delegation program and cannot be closed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true,
          "address": "DpGpgVgUyZMCq2HX4mnACi8tXALhE7U1HSQqgUSk3cTh"
        },
        {
          "name": "vault",
          "docs": [
            "with a zero balance. After `settle` it is already gone, so the account may be empty."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createRoom",
      "discriminator": [
        130,
        166,
        32,
        2,
        247,
        120,
        178,
        53
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "arg",
                "path": "args.room_id"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "Escrow. Never delegated; authority is the room PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createRoomArgs"
            }
          }
        }
      ]
    },
    {
      "name": "delegatePosition",
      "discriminator": [
        194,
        231,
        117,
        130,
        72,
        142,
        185,
        112
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "bufferPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "position"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                98,
                20,
                109,
                203,
                86,
                128,
                73,
                22,
                2,
                200,
                148,
                50,
                205,
                66,
                18,
                224,
                240,
                31,
                126,
                178,
                104,
                239,
                89,
                161,
                116,
                214,
                245,
                129,
                194,
                47,
                212,
                126
              ]
            }
          }
        },
        {
          "name": "delegationRecordPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "position"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "7bs2GJKVpupZgmwGWteQhnSup3e1wuNtQ4yqfd6Xx89T"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finalizeRound",
      "discriminator": [
        239,
        160,
        254,
        11,
        254,
        144,
        53,
        148
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initConfig",
      "discriminator": [
        23,
        235,
        115,
        232,
        168,
        96,
        1,
        231
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "feeVault"
        },
        {
          "name": "program",
          "docs": [
            "Only the program's upgrade authority can create the config (no front-running on deploy)."
          ],
          "address": "7bs2GJKVpupZgmwGWteQhnSup3e1wuNtQ4yqfd6Xx89T"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "minEntry",
          "type": "u64"
        },
        {
          "name": "maxEntry",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initPermission",
      "discriminator": [
        66,
        14,
        153,
        250,
        187,
        36,
        179,
        236
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "permission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "position"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinRoom",
      "discriminator": [
        95,
        232,
        188,
        81,
        124,
        130,
        78,
        139
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "rating",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  108,
                  111
                ]
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "playerToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "viewer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "rateRoom",
      "discriminator": [
        198,
        79,
        87,
        222,
        162,
        220,
        199,
        189
      ],
      "accounts": [
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "releasePosition",
      "discriminator": [
        94,
        172,
        120,
        22,
        53,
        15,
        201,
        249
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "docs": [
            "Not delegated in this path: the ER reads Solana's copy."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "requestStorm",
      "discriminator": [
        179,
        73,
        6,
        95,
        195,
        255,
        119,
        146
      ],
      "accounts": [
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "programIdentity",
          "address": "EBDkMF44koAzmX1nwQaj9EshPaazHc92R1RQmGD6Zywf"
        },
        {
          "name": "oracleQueue",
          "writable": true
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setPosition",
      "discriminator": [
        31,
        61,
        82,
        30,
        244,
        227,
        93,
        86
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "room",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "room"
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "sessionToken",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "i8"
        },
        {
          "name": "leverage",
          "type": "u8"
        },
        {
          "name": "assetIdx",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settle",
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "room",
          "docs": [
            "Must be back on Solana (owned by this program again): Anchor's owner check enforces it."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "creator",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "startRoom",
      "discriminator": [
        1,
        255,
        77,
        194,
        171,
        170,
        62,
        248
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "bufferRoom",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                98,
                20,
                109,
                203,
                86,
                128,
                73,
                22,
                2,
                200,
                148,
                50,
                205,
                66,
                18,
                224,
                240,
                31,
                126,
                178,
                104,
                239,
                89,
                161,
                116,
                214,
                245,
                129,
                194,
                47,
                212,
                126
              ]
            }
          }
        },
        {
          "name": "delegationRecordRoom",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataRoom",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "room"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "room",
          "docs": [
            "ownership moves to the delegation program."
          ],
          "writable": true
        },
        {
          "name": "ownerProgram",
          "address": "7bs2GJKVpupZgmwGWteQhnSup3e1wuNtQ4yqfd6Xx89T"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "tick",
      "discriminator": [
        92,
        79,
        44,
        8,
        101,
        80,
        63,
        15
      ],
      "accounts": [
        {
          "name": "room",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  111,
                  111,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "room.room_id",
                "account": "room"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  102,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "feeVault",
          "docs": [
            "Optional new fee vault (must hold the configured mint)."
          ],
          "optional": true
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "updateConfigArgs"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "rating",
      "discriminator": [
        203,
        130,
        231,
        178,
        120,
        130,
        70,
        17
      ]
    },
    {
      "name": "room",
      "discriminator": [
        156,
        199,
        67,
        27,
        222,
        23,
        185,
        94
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6001,
      "name": "paused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6002,
      "name": "invalidFee",
      "msg": "Invalid fee"
    },
    {
      "code": 6003,
      "name": "invalidEntry",
      "msg": "Entry amount out of bounds"
    },
    {
      "code": 6004,
      "name": "invalidSeats",
      "msg": "Seats must be between 4 and 16"
    },
    {
      "code": 6005,
      "name": "invalidAssets",
      "msg": "Rooms need 1 to 3 distinct whitelisted assets"
    },
    {
      "code": 6006,
      "name": "invalidTiming",
      "msg": "Invalid timing parameter"
    },
    {
      "code": 6007,
      "name": "wrongMint",
      "msg": "Wrong mint"
    },
    {
      "code": 6008,
      "name": "roomNotOpen",
      "msg": "Room is not open"
    },
    {
      "code": 6009,
      "name": "roomFull",
      "msg": "Room is full"
    },
    {
      "code": 6010,
      "name": "fillExpired",
      "msg": "Fill window has closed"
    },
    {
      "code": 6011,
      "name": "alreadyJoined",
      "msg": "Already joined"
    },
    {
      "code": 6012,
      "name": "notStartable",
      "msg": "Room can't start yet"
    },
    {
      "code": 6013,
      "name": "notCancellable",
      "msg": "Room can't be cancelled"
    },
    {
      "code": 6014,
      "name": "wrongStatus",
      "msg": "Wrong room status"
    },
    {
      "code": 6015,
      "name": "roundNotLive",
      "msg": "Round is not live"
    },
    {
      "code": 6016,
      "name": "positionMismatch",
      "msg": "Position accounts don't match the room's seats"
    },
    {
      "code": 6017,
      "name": "feedMismatch",
      "msg": "Feed accounts don't match the room's assets"
    },
    {
      "code": 6018,
      "name": "eliminated",
      "msg": "Position is eliminated"
    },
    {
      "code": 6019,
      "name": "holdTime",
      "msg": "Minimum hold time not reached"
    },
    {
      "code": 6020,
      "name": "invalidLeverage",
      "msg": "Leverage not allowed"
    },
    {
      "code": 6021,
      "name": "invalidSide",
      "msg": "Invalid side"
    },
    {
      "code": 6022,
      "name": "invalidAsset",
      "msg": "Asset index out of range"
    },
    {
      "code": 6023,
      "name": "sideFrozen",
      "msg": "That side is frozen by a storm"
    },
    {
      "code": 6024,
      "name": "noChange",
      "msg": "No change in position"
    },
    {
      "code": 6025,
      "name": "oracleWrongAccount",
      "msg": "Oracle account is not the pinned feed"
    },
    {
      "code": 6026,
      "name": "oracleWrongOwner",
      "msg": "Oracle account has the wrong owner"
    },
    {
      "code": 6027,
      "name": "oracleDecode",
      "msg": "Oracle account could not be decoded"
    },
    {
      "code": 6028,
      "name": "oracleStale",
      "msg": "Oracle price is stale"
    },
    {
      "code": 6029,
      "name": "oracleInvalid",
      "msg": "Oracle price is invalid"
    },
    {
      "code": 6030,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6031,
      "name": "notPermissioned",
      "msg": "Positions are not all permissioned"
    },
    {
      "code": 6032,
      "name": "tooEarly",
      "msg": "Begin timeout has not passed"
    },
    {
      "code": 6033,
      "name": "stillDelegated",
      "msg": "Room is still delegated"
    },
    {
      "code": 6034,
      "name": "alreadySettled",
      "msg": "Room already settled"
    },
    {
      "code": 6035,
      "name": "payoutAccountMismatch",
      "msg": "Payout account mismatch"
    },
    {
      "code": 6036,
      "name": "vaultShort",
      "msg": "Vault balance below pot"
    },
    {
      "code": 6037,
      "name": "alreadyRated",
      "msg": "Ratings already updated"
    },
    {
      "code": 6038,
      "name": "ratingMismatch",
      "msg": "Rating accounts don't match the room's seats"
    },
    {
      "code": 6039,
      "name": "wrongQueue",
      "msg": "Wrong VRF oracle queue"
    },
    {
      "code": 6040,
      "name": "positionInUse",
      "msg": "Position still in use"
    },
    {
      "code": 6041,
      "name": "vaultNotEmpty",
      "msg": "Vault still holds tokens"
    }
  ],
  "types": [
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "feeVault",
            "docs": [
              "USDC token account that receives fees and dust."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "minEntry",
            "type": "u64"
          },
          {
            "name": "maxEntry",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "roomsCreated",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "createRoomArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roomId",
            "type": "u64"
          },
          {
            "name": "entryAmount",
            "type": "u64"
          },
          {
            "name": "maxSeats",
            "type": "u8"
          },
          {
            "name": "assets",
            "docs": [
              "Pyth Lazer ids from the pinned whitelist, 1 to 3, distinct."
            ],
            "type": {
              "vec": "u16"
            }
          },
          {
            "name": "fillSecs",
            "docs": [
              "Seconds until the room may start short-handed or be cancelled. 0 = default (10 min)."
            ],
            "type": "i64"
          },
          {
            "name": "intervalSecs",
            "docs": [
              "Seconds per interval (6 intervals per round). 0 = default (60 s)."
            ],
            "type": "u16"
          },
          {
            "name": "private",
            "docs": [
              "Seal positions inside the TEE with owner-only permissions."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "room",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "seat",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "side",
            "docs": [
              "-1 short, 0 flat, 1 long."
            ],
            "type": "i8"
          },
          {
            "name": "leverage",
            "type": "u8"
          },
          {
            "name": "assetIdx",
            "type": "u8"
          },
          {
            "name": "alive",
            "type": "bool"
          },
          {
            "name": "liquidated",
            "type": "bool"
          },
          {
            "name": "permissioned",
            "type": "bool"
          },
          {
            "name": "entryPrice",
            "type": "i64"
          },
          {
            "name": "entryTs",
            "docs": [
              "When the current position was opened or last re-marked at a checkpoint."
            ],
            "type": "i64"
          },
          {
            "name": "equityAtOpen",
            "type": "u64"
          },
          {
            "name": "equity",
            "docs": [
              "Equity at the last mark (private while the round runs)."
            ],
            "type": "u64"
          },
          {
            "name": "lastActionTs",
            "type": "i64"
          },
          {
            "name": "actions",
            "type": "u32"
          },
          {
            "name": "viewer",
            "docs": [
              "The player's browser session key: a second permission member, so the app can read the",
              "sealed position through the TEE without another wallet popup. Default = none."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "rating",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "elo",
            "type": "i32"
          },
          {
            "name": "games",
            "type": "u32"
          },
          {
            "name": "wins",
            "type": "u32"
          },
          {
            "name": "top3",
            "type": "u32"
          },
          {
            "name": "bestEquity",
            "type": "u64"
          },
          {
            "name": "lastRoom",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "room",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "roomId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "entryAmount",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "maxSeats",
            "type": "u8"
          },
          {
            "name": "seatsFilled",
            "type": "u8"
          },
          {
            "name": "aliveCount",
            "type": "u8"
          },
          {
            "name": "finalistsTarget",
            "type": "u8"
          },
          {
            "name": "nextCheckpoint",
            "docs": [
              "Next checkpoint to process (1..=FINAL_CHECKPOINT)."
            ],
            "type": "u8"
          },
          {
            "name": "numAssets",
            "type": "u8"
          },
          {
            "name": "intervalSecs",
            "type": "u16"
          },
          {
            "name": "assets",
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          },
          {
            "name": "feeds",
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "exponents",
            "type": {
              "array": [
                "i8",
                3
              ]
            }
          },
          {
            "name": "createdTs",
            "type": "i64"
          },
          {
            "name": "fillExpiry",
            "type": "i64"
          },
          {
            "name": "startedTs",
            "docs": [
              "When start_room delegated the room."
            ],
            "type": "i64"
          },
          {
            "name": "startTs",
            "docs": [
              "Round clock origin (begin_round)."
            ],
            "type": "i64"
          },
          {
            "name": "endTs",
            "type": "i64"
          },
          {
            "name": "players",
            "type": {
              "array": [
                "pubkey",
                16
              ]
            }
          },
          {
            "name": "elimCheckpoint",
            "docs": [
              "0 = alive; k = cut at checkpoint k."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "placement",
            "docs": [
              "Final placement, 1 = winner. 0 = still alive."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "publicRank",
            "docs": [
              "Rank among the alive at the last checkpoint (1 = leader). 0 = eliminated / not yet ranked."
            ],
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "finalEquity",
            "docs": [
              "Equity at elimination or at the end. Never written while a player is alive."
            ],
            "type": {
              "array": [
                "u64",
                16
              ]
            }
          },
          {
            "name": "lastPrice",
            "docs": [
              "Oracle prices used at the last checkpoint (public input, for the UI)."
            ],
            "type": {
              "array": [
                "i64",
                3
              ]
            }
          },
          {
            "name": "finalistCount",
            "docs": [
              "Number of finalists at the end (1..=3), seats in `finalist_seats` best-first."
            ],
            "type": "u8"
          },
          {
            "name": "finalistSeats",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "stormKind",
            "docs": [
              "One storm slot per interval (0..=CHECKPOINTS). Kind 0 = no storm."
            ],
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "stormAsset",
            "type": {
              "array": [
                "u8",
                6
              ]
            }
          },
          {
            "name": "stormSide",
            "type": {
              "array": [
                "i8",
                6
              ]
            }
          },
          {
            "name": "stormsRequested",
            "docs": [
              "Bitmask of intervals whose storm was requested / fulfilled."
            ],
            "type": "u8"
          },
          {
            "name": "stormsFulfilled",
            "type": "u8"
          },
          {
            "name": "stormsSeen",
            "type": "u8"
          },
          {
            "name": "vrfSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "seedSet",
            "type": "bool"
          },
          {
            "name": "taskId",
            "type": "i64"
          },
          {
            "name": "ticks",
            "type": "u32"
          },
          {
            "name": "private",
            "docs": [
              "TEE privacy on: begin_round requires every position to have an owner-only permission."
            ],
            "type": "bool"
          },
          {
            "name": "rated",
            "type": "bool"
          },
          {
            "name": "refunded",
            "docs": [
              "Bitmask of seats refunded on the cancel path."
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "sessionTokenV2",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "feePayer",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "updateConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "minEntry",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxEntry",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "newAdmin",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    }
  ]
};
