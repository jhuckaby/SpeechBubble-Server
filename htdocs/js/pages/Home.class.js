Class.subclass( Page.Base, "Page.Home", {	
	
	onInit: function() {
		// called once at page load
		var html = '';
		html += '<div style="padding:10px 20px 20px 20px">';
		
		// header stats
		
		html += '<div id="d_home_header_stats"></div>';
		
		html += '</div>'; // container
		
		this.div.html( html );
	},
	
	onActivate: function(args) {
		// page activation
		if (!this.requireLogin(args)) return true;
		
		if (!args) args = {};
		this.args = args;
		
		app.setWindowTitle('Home');
		app.showTabBar(true);
		
		app.api.post( 'app/get_home_info', {}, this.receive_home_info.bind(this) );
		
		return true;
	},
	
	receive_home_info: function(resp) {
		// receive info from server
		var html = '';
		var status = resp.status;
		// this.div.removeClass('loading');
		
		// wrapper div
		html += '<div style="padding:6px;">';
		
		if (resp.status) {
			html += '<div style="width:100%; margin-bottom:15px;">';
				html += '<fieldset style="margin-right:0px; padding-top:10px;"><legend>Server Status</legend>';
					
					html += '<div style="float:left; width:25%;">';
						html += '<div class="info_label">SERVER HOSTNAME</div>';
						html += '<div class="info_value">' + status.hostname + '</div>';
						
						html += '<div class="info_label">OS VERSION</div>';
						html += '<div class="info_value">' + status.os_version + '</div>';
						
						html += '<div class="info_label">SERVICE UPTIME</div>';
						html += '<div class="info_value">' + get_text_from_seconds(status.now - status.server_started, false, true) + '</div>';
					html += '</div>';
					
					html += '<div style="float:left; width:25%;">';
						html += '<div class="info_label">USERS ONLINE</div>';
						html += '<div class="info_value">' + commify(status.users_online) + '</div>';
						
						html += '<div class="info_label">REGISTERED USERS</div>';
						html += '<div class="info_value">' + commify(status.total_users) + '</div>';
						
						html += '<div class="info_label">REGISTERED CHANNELS</div>';
						html += '<div class="info_value">' + commify(status.total_channels) + '</div>';
					html += '</div>';
					
					html += '<div style="float:left; width:25%;">';
						html += '<div class="info_label">MESSAGES SENT (TODAY)</div>';
						html += '<div class="info_value">' + commify(status.total_messages_sent) + '</div>';
						
						html += '<div class="info_label">TOTAL BYTES IN (TODAY)</div>';
						html += '<div class="info_value">' + get_text_from_bytes(status.total_bytes_in) + '</div>';
						
						html += '<div class="info_label">TOTAL BYTES OUT (TODAY)</div>';
						html += '<div class="info_value">' + get_text_from_bytes(status.total_bytes_out) + '</div>';
					html += '</div>';
									
					html += '<div style="float:left; width:25%;">';
						html += '<div class="info_label">MEMORY IN USE</div>';
						html += '<div class="info_value">' + get_text_from_bytes(status.total_mem_bytes) + '</div>';
						
						html += '<div class="info_label">CPU IN USE</div>';
						html += '<div class="info_value">' + status.total_cpu_pct + '%</div>';
						
						html += '<div class="info_label">APP VERSION</div>';
						html += '<div class="info_value">' + app.version + '</div>';
						
						/*html += '<div class="info_label">DISK SPACE USED</div>';
						html += '<div class="info_value">' + get_text_from_bytes(status.total_disk_usage) + '</div>';*/
					html += '</div>';
					
					html += '<div class="clear"></div>';
					
				html += '</fieldset>';
			html += '</div>';
		} // full server status
		
		// basic info, admin or no, created / modified
		html += '<div style="float:left; width:50%;">';
			html += '<fieldset style="margin-right:8px; padding-top:10px;"><legend>My Account Info</legend>';
				
				html += '<div style="float:left; width:50%;">';
					html += '<div class="info_label">NICKNAME</div>';
					html += '<div class="info_value">' + app.username + '</div>';
					
					html += '<div class="info_label">REAL NAME</div>';
					html += '<div class="info_value">' + app.user.full_name + '</div>';
					
					html += '<div class="info_label">EMAIL ADDRESS</div>';
					html += '<div class="info_value">' + app.user.email + '</div>';
				html += '</div>';
				
				html += '<div style="float:right; width:50%;">';
					html += '<div class="info_label">ACCOUNT TYPE</div>';
					html += '<div class="info_value">' + (app.isAdmin() ? '<span class="color_label admin">Administrator</span>' : '<span class="color_label" style="background:gray;">Standard</span>') + '</div>';
					
					html += '<div class="info_label">REGISTERED</div>';
					html += '<div class="info_value">' + get_nice_date_time(app.user.created) + '</div>';
					
					html += '<div class="info_label">LAST MODIFIED</div>';
					html += '<div class="info_value">' + get_nice_date_time(app.user.modified) + '</div>';
				html += '</div>';
				
				html += '<div class="clear"></div>';
				
			html += '</fieldset>';
		html += '</div>';
		
		// current irc login or last login
		// last command, when
		html += '<div style="float:right; width:50%;">';
			html += '<fieldset style="margin-left:8px; padding-top:10px;"><legend>Chat Connection</legend>';
				
				html += '<div style="float:left; width:50%;">';
					html += '<div class="info_label">STATUS</div>';
					html += '<div class="info_value">' + (status.user_online ? '<span class="color_label online">Connected</span>' : '<span class="color_label offline">Disconnected</span>') + '</div>';
					
					html += '<div class="info_label">' + 'LOGGED IN' + '</div>';
					html += '<div class="info_value">' + (status.user_online ? get_nice_date_time(status.user_login_time) : 'n/a') + '</div>';
					
					html += '<div class="info_label">' + 'IP ADDRESS' + '</div>';
					html += '<div class="info_value">' + (status.user_ip ? status.user_ip : 'n/a') + '</div>';
				html += '</div>';
				
				html += '<div style="float:right; width:50%;">';
					html += '<div class="info_label">LAST ACTIVITY</div>';
					html += '<div class="info_value">' + (status.user_cmd_time ? get_nice_date_time(status.user_cmd_time) : 'n/a') + '</div>';
					
					html += '<div class="info_label">LAST COMMAND</div>';
					html += '<div class="info_value" style="line-height:14px; max-height:42px; overflow:hidden;">' + (status.user_last_cmd ? status.user_last_cmd : 'n/a') + '</div>';
				html += '</div>';
				
				html += '<div class="clear"></div>';
				
			html += '</fieldset>';
		html += '</div>';
		
		html += '<div class="clear"></div>';
		
		html += '</div>'; // wrapper
		
		$('#d_home_header_stats').html( html );
	},
	
	onDeactivate: function() {
		// called when page is deactivated
		// this.div.html( '' );
		return true;
	}
	
} );
