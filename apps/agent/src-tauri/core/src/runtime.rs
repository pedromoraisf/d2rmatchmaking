//! The runtime (design.md § Runtime, state and telemetry; AGS-09, AGS-12). It starts the loops on the caller's tokio
//! runtime, publishes every state change through the state sink and takes the two commands the app sends: "Get a new
//! code", and (fixture builds only, AD-057) one read of a frame.

use std::sync::Arc;

use tokio::sync::mpsc;

use crate::config::Config;
use crate::context::{Adapters, Context};
use crate::fusion::fuse;
use crate::observations;
use crate::pairing::{self, Command};
use crate::ports::Rgba;
use crate::{heartbeat, stream, updates, vision};

const COMMAND_BUFFER: usize = 8;

/// Starts the agent's loops. Call it inside a tokio runtime; the loops run until the process ends.
pub struct Runtime;

impl Runtime {
    /// Builds the context and starts pairing, heartbeat, stream and update loops.
    pub fn start(config: &Config, http: reqwest::Client, adapters: Adapters) -> Handle {
        let ctx = Context::new(config, http, adapters);
        let (commands, receiver) = mpsc::channel(COMMAND_BUFFER);
        tokio::spawn(pairing::run(Arc::clone(&ctx), receiver));
        tokio::spawn(heartbeat::run(Arc::clone(&ctx)));
        tokio::spawn(stream::run(Arc::clone(&ctx)));
        tokio::spawn(updates::run(Arc::clone(&ctx)));
        Handle { ctx, commands }
    }
}

/// What the app holds of a running agent: the commands it may send.
pub struct Handle {
    ctx: Arc<Context>,
    commands: mpsc::Sender<Command>,
}

impl Handle {
    /// "Get a new code": honoured only while the pairing loop is paused (AGS-34).
    pub fn get_new_code(&self) {
        let _ = self.commands.try_send(Command::GetNewCode);
    }

    /// Reads the game name from one frame and posts an observation when it names the held room. Without a held assignment
    /// nothing happens. Only the app's fixture build calls this (AD-057).
    pub fn read_once(&self, frame: Rgba) {
        let assignment = self.ctx.assignment.borrow().clone();
        let Some(assignment) = assignment else {
            return;
        };
        let ctx = Arc::clone(&self.ctx);
        tokio::spawn(async move {
            let Ok(read) = vision::read_game_name(&frame, ctx.reader.as_ref()) else {
                return;
            };
            let now = ctx.clock.now_utc();
            if let Some(fusion) = fuse(&read, &assignment, now, ctx.ids.as_ref()) {
                observations::send(&ctx, fusion.room, &fusion.observation).await;
            }
        });
    }
}
